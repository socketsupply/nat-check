#! /bin/env node

//Endpoint Independent Mapping - same host, same port, if from same port
//Endpoint Dependent Mapping - messages from the same port mapped through different ports for different host:port combinations
//static

// types of nattedness
//   - nonat / static. ip is reachable from everywhere
//   - semistatic - static ip but no uptime promise
//   - endpoint independent 
//   - endpoint dependent

// upnp can sometimes be used to create a semistatic ip address, that keeps the same
// outside address open.

//use a default port so that local multicast works
var PORT = 1999

var niceAgo = require('nice-ago')
var os = require('os')

function Peer (addr) {
  return {
    address: addr.address,
    port: addr.port,
    id: addr.id,
    recv: {ts: 0, count: 0},
    send: {ts: 0, count: 0},
    from: []
  }
}

function my_addresses() {
  var addrs = {}
  var ints = os.networkInterfaces()
  for(var int in ints)
    ints[int].forEach(v => addrs[v.address] = true)
  return addrs
}

function getOrAddPeer(peers, info) {
  for(var i = 0; i < peers.length; i++)
    if(peers[i].address == info.address && peers[i].port === info.port)
      return peers[i]
  var p = Peer(info)
  peers.push(p)
  return p
}

function isSelf(peer) {
  if(!peer) return false
  if(peer.address == '0.0.0.0') return true
  if(peer.address == '127.0.0.1') return true
  if(my_addresses()[peer.address]) return true
  return false
}

function createBase (id, socket, handlers) {
  var peers = []
  var dht = {
    send (msg, peer) {
      if(isSelf(peer)) return
      if(peer.id == id) return //do not send to self
      if(peer.send) {
        peer.send.ts = Date.now()
        peer.send.count ++
      }
      socket.send(msg, peer.port, peer.address)
    },
    broadcast (msg) {
      peers.forEach(p => this.send(msg, p))
    },
    broadcastMap (fn) {
      peers.forEach(p => { var msg = fn(p); if(msg) this.send(msg, p) })
    },
    peers
  }

  socket.on('message', function (buf, rinfo, port) {
    //most receive on a secondary port should be ignored
    if(isSelf(rinfo)) return
    //console.error("RECV", buf, rinfo)
    //ignore loopback messages to ourselves
  //  if(port && port != PORT) {
    var peer = getOrAddPeer(peers, rinfo)
    peer.recv.count ++
    peer.recv.ts = Date.now()

    var type = buf[0]
    var handler = handlers[type]
    if('function' === typeof handler)
      handler(dht, buf, peer)
    else
      console.log('unknown message:',type)
  })

  return dht

}

var TX_PING  = 0x10,
    RX_PING  = 0x11,
    TX_PEERS = 0x20,
    RX_PEERS = 0x21,
    TX_FORWARD = 0x30
 
var Ipv4 = {
  encode: function (peer, buffer, start) {
    peer.address.split('.').forEach((e, j) => {
      buffer[start+j] = +e
    })
    buffer.writeUint16BE(peer.port, 4)
    return 2+4
  },
  decode: function (buffer, start) {
    return {
      address:
        buffer[start]   + '.' +
        buffer[start+1] + '.' +
        buffer[start+2] + '.' +
        buffer[start+3],
      port: buffer.readUInt16BE(4),
    }
  },
  bytes: 2+4
}

var Ipv4Peer = {
  encode: function (peer, buffer, start) {
    Ipv4.encode(peer, buffer, start)
    if(peer.id)
      buffer.write(peer.id, start+Ipv4.bytes, 'hex')
    return Ipv4Peer.bytes+32
  },
  decode: function (buffer, start) {
    var peer = Ipv4.decode(buffer, start)
    peer.id = buffer.toString('hex', 6, 6+32)
    return peer
  },
  bytes: Ipv4.bytes + 32
}

function interval (fn, time) {
  setInterval(fn, time).unref()
  fn()
}

function createDHT (socket, seeds, id) {

//  var Ping = Buffer.from([PING])

  var Ping = Buffer.alloc(1+32)
  Ping[0] = TX_PING
  Ping.write(id, 1, 'hex')

//  var socket = dgram.createSocket('udp4')
  var me, me2
  var dht = createBase(id, socket, {
    [TX_PING]: function(dht, buf, peer) {
      var res = Buffer.alloc(1+32+6)
      res[0] = RX_PING
      if(!peer.id)
        peer.id = buf.toString('hex', 1, 33)
      //write our own id into the buffer
      res.write(id, 1, 'hex')
      //write the ip:port of the peer we received from
      Ipv4.encode(peer, res, 1+32)
      dht.send(res, peer)
    },
    [RX_PING]: function (dht, buf, peer) {
      //receive pong isn't important
      peer.id = peer.id || buf.toString('hex', 1, 33)
      //receive what our ip:port looks like from the outside.
      var _me = Ipv4.decode(buf, 1+32)
      if(!me) me = _me
      peer.pinged = _me
      //record round trip time. (if it makes sense)
      if(peer.send.ts < peer.recv.ts) {
        peer.rtt = peer.recv.ts - peer.send.ts
      }

      if(!(me.port == _me.port && me.address == _me.address))
        console.error("NAT PROBLEM", me, _me)

      update()
    }, 
    [TX_PEERS]: function (dht, buf, peer) {
//      console.error("TX_PEERS", dht.peers)
      var _peers = dht.peers.filter(function (p) {
        //don't send peer back to requesting peer
        if(p === peer) return
        //don't seed peer that hasn't been heard from in 3 minutes 
        if(p.recv.ts + 3*60_000 < Date.now())
          return
        return true
      })
  //    if(!_peers.length)
  //      console.error('no peers to send')
      var b = Buffer.alloc(1+(_peers.length*Ipv4Peer.bytes))
      b[0] = RX_PEERS
      _peers.forEach((peer, i) => {
        Ipv4Peer.encode(peer, b, 1+i*6)
      })
      dht.send(b, peer)
    },
    [RX_PEERS]: function (dht, buf, peer) {
      var start = 1
      for(var start = 1; start + Ipv4Peer.bytes <= buf.length; start += Ipv4Peer.bytes) {
        var new_peer = Ipv4.decode(buf, start)
        var p = getOrAddPeer(dht.peers, new_peer)
        //console.error("NP", new_peer)
        if(~p.from.indexOf(peer))
          p.from.push(peer)
       //try to ping new peer, but not if we already pinged them within 30 seconds
        if(!p.recv.ts && p.send.ts + 30_000 > Date.now())
          dht.send(Ping, p)
      }
      update()

    },
    //forwarding is used for holepunching
    [TX_FORWARD]: function (dht, buf, peer) {
      var next_peer = Ipv4.decode(buf, 1)
      dht.send(buf.slice(1+Ipv4.bytes), next_peer)
    }
  })

  seeds.forEach(function (p) {
    getOrAddPeer(dht.peers, p)    
  })

  //ping active peers every 30 seconds
  //active peers means we have received from them within 2 minutes
  interval(() => {
    dht.broadcastMap((peer) => {
//      if(peer.recv.ts + 2*60_000 < Date.now())
        return Ping
    })
    dht.send(Ping, {address:'255.255.255.255', port: PORT})
  }, 10_000)

  interval(() => {
    dht.broadcastMap((peer) => {
   //   if(peer.recv.ts + 2*60_000 < Date.now())
        return Buffer.from([TX_PEERS])
    })
  }, 10_000)
  
  function update () {
    pretty(id, me, dht.peers)
  }
  interval(update, 5000)
}

function addr2String(p) {
  return p.address+':'+p.port
}
function pretty (id, me, peers) {
  var padding = [10, 20, -5, -5, -7, -6]

 // console.log('\033[2J\033[H')
  console.log('My ip:', me ? addr2String(me) : 'unknown')
  console.log('id:', id)
  console.log('Time:'+new Date().toISOString())
  console.log()

  var ts = Date.now()
  var table = peers.map(e => {
    return [
      e.id && e.id.substring(0, 8),
      addr2String(e),
      e.send.count,
      e.recv.count,
      e.rtt,
      e.recv.ts ? niceAgo(ts, e.recv.ts) : 'na'
    ]
  })
 
  console.log(
    [['Id', 'ip', 'Send', 'Recv', 'RTT', 'alive'], ...table]
    .map(row => {
      return row.map((e, i) => (
        padding[i] < 0
        ? (e||'').toString().padStart(padding[i] * -1, ' ')
        : (e||'').toString().padEnd(padding[i], ' ')
      )).join('')
    }).join('\n')
  )
}

if(!module.parent) {
  var fs = require('fs')
  var socket = require('./many').createSocket('udp4')
  socket.on('listening', function () { socket.setBroadcast() })
  var id = require('crypto').randomBytes(32).toString('hex')
  var path = require('path')
  var id_file = path.join(process.env.HOME, '.p2p_id')
  try {
    id = fs.readFileSync(id_file, 'utf8')
  } catch (_) {
    fs.writeFileSync(id_file, id, 'utf8')
  }
  var seeds = process.argv.slice(2).map(e => {
    var [address, port] = e.split(':')
    return {address, port: +port}
  })
  socket.bind(PORT)
 // setTimeout(function () {
 //   socket.setBroadcast(true)
 // }, 1000)
  createDHT(socket, seeds, id)
  
}
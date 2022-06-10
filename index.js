#! /bin/env node

//use a default port so that local multicast works
var PORT = 1999

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

function getOrAddPeer(peers, info) {
  for(var i = 0; i < peers.length; i++)
    if(peers[i].address == info.address && peers[i].port === info.port)
      return peers[i]
  var p = Peer(info)
  peers.push(p)
  return p
}

function createBase (socket, handlers) {
  var peers = []
  var dht = {
    send (msg, peer) {
      console.error('send', peer, msg)
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

  socket.on('message', function (buf, rinfo) {
    console.error('recv', rinfo, buf)
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
  var me
  var dht = createBase(socket, {
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
      console.log('ME', me)
    }, 
    [TX_PEERS]: function (dht, buf, peer) {
      var _peers = dht.peers.filter(function (p) {
        //don't send peer back to requesting peer
        if(p === peer) return
        //don't seed peer that hasn't been heard from in 3 minutes 
        if(p.recv.ts + 3*60_000 < Date.now())
          return
        return true
      })
      if(!_peers.length)
        console.log('no peers to send')
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
        var p = getOrAddPeer(dht.peers, Ipv4.decode(buf, start))
        if(~p.from.indexOf(peer))
          p.from.push(peer)
       //try to ping new peer, but not if we already pinged them within 30 seconds
        if(!p.recv.ts && p.send.ts + 30_000 > Date.now())
          dht.send(Ping, p)
      }
    },
    //forwarding is used for holepunching
    [TX_FORWARD]: function (dht, buf, peer) {
      var next_peer = Ipv4.decode(buf, 1)
      dht.send(buf.slice(1+Ipv4.bytes), next_peer)
    }
  })

  console.log("SEEDS", seeds)
  seeds.forEach(function (p) {
    getOrAddPeer(dht.peers, p)    
  })


  //ping active peers every 30 seconds
  //active peers means we have received from them within 2 minutes
  console.log(Ping)
  interval(() => {
    console.log(dht.peers)
    dht.broadcastMap((peer) => {
      if(peer.recv.ts + 2*60_000 < Date.now())
        return Ping
    })
    dht.send(Ping, {address:'255.255.255.255', port: PORT})
  }, 10_000)

  interval(() => {
    dht.broadcastMap((peer) => {
      if(peer.recv.ts + 2*60_000 < Date.now())
        return Buffer.from([TX_PEERS])
    })
  }, 10_000)
  

}

if(!module.parent) {
  var socket = require('dgram').createSocket('udp4')
  var seeds = process.argv.slice(2).map(e => {
    var [address, port] = e.split(':')
    return {address, port: +port}
  })
  socket.bind(PORT)
  var id = require('crypto').randomBytes(32).toString('hex')
  createDHT(socket, seeds, id)

}
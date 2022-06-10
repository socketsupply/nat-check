//use a default port so that local multicast works
var PORT = 1999

function Peer (addr) {
  return {
    host: addr.host,
    port: addr.port,
    id: addr.id,
    recv: {ts: 0, count: 0},
    send: {ts: 0, count: 0},
    from: []
  }
}

function createBase (socket, handlers) {
  var peers = []
  var dht = {
    send (peer, msg) {
      peer.send.ts = Date.now()
      peer.send.count ++
      socket.send(msg, peer.port, peer.host)
    },
    broadcast (msg) {
      peers.forEach(p => this.send(p, msg))
    },
    broadcastMap (fn) {
      peers.forEach(p => { var msg = fn(p); if(msg) this.send(p, msg) })
    },
    peers
  }

  function getOrAddPeer(info) {
    for(var i = 0; i < peers.length; i++)
      if(peers[i].host == info.host && peers[i].port === info.port)
        return peers[i]
    var p = Peer(info)
    peers.push(p)
    return p
  }

  socket.on('message', function (buf, rinfo) {
    var peer = getOrAddPeer(rinfo)
    peer.recv.count ++
    peer.recv.ts = Date.now()

    var type = buf.readUInt16LE(0)
    handlers[type](dht, buf, peer)
  })

  return dht

}

var TX_PING  = 0x10,
    RX_PING  = 0x11,
    TX_PEERS = 0x20,
    RX_PEERS = 0x21,
    TX_FORWARD = 0x30
 
var IPv4 = {
  encode: function (peer, buffer, start) {
    peer.host.split('.').forEach((e, j) => {
      buffer[start+j] = +e
    })
    buffer.writeUint16BE(peer.port, 4)
    return 2+4
  },
  decode: function (buffer, start) {
    var id = Buffer.alloc(32)
    buffer.copy(id, 0, start+6)
    return {
      host:
        buffer[start]   + '.' +
        buffer[start+1] + '.' +
        buffer[start+2] + '.' +
        buffer[start+3],
      port: buffer.readUInt32BE(4),
    }
  }
}

var IPv4Peer = {
  encode: function (peer, buffer, start) {
    IPv6Peer.encode(peer, buffer, start)
    buffer.write(peer.id, start+Ipv4Peer.bytes, 'hex')
    return Ipv4Peer.bytes+32
  },
  decode: function (buffer, start) {
    var peer = Ipv4.decode(buffer, start)
    peer.id = buffer.toString('hex', 6, 6+32)
    return peer
  }
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
      res[0] = PONG
      if(!peer.id)
        peer.id = buf.slice(1, 1+32)
      //write our own id into the buffer
      id.copy(res, 0, 1)
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

      if(!(me.port == _me.port && me.host == _me.host))
        console.error("NAT PROBLEM", me, _me)
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
      var b = Buffer.alloc(1+_peers.length)
      b[0] = RES_PEERS
      _peers.forEach((peer, i) => {
        IPv4PEER.encode(peer, b, 1+i*6)
      })
      dht.send(b)
    },
    [RX_PEERS]: function (dht, buf, peer) {
      var start = 1
      for(var start = 1; start + IPV4Peer.bytes <= buf.length; start += IPV4Peer.bytes) {
        var p = getOrAddPeer(IPv4.decode(buf, start))
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

  //ping active peers every 30 seconds
  //active peers means we have received from them within 2 minutes
  setInterval(() => {
    console.log(dht.peers)
    dht.broadcastMap((peer) => {
      if(peer.recv.ts + 2*60_000 < Date.now())
        return Ping
    })
    dht.send(Ping, {host:'255.255.255.255', port: PORT})
  }, 60_000).unref()

}

if(!module.parent) {
  var socket = require('dgram').createSocket('udp4')
  var seeds = process.argv.slice(3).map(e => {
    var [host, port] = e.split(':')
  })
  socket.bind(PORT)
  var id = require('crypto').randomBytes(32).toString('hex')
  createDHT(socket, seeds, id)

}
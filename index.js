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

var {Ipv4, Ipv4Peer} = require('./codec')
var {pretty, addr2String} = require('./util')

//a peer has a unique id
//and can have multiple addresses

// or should the model be about addresses not peers?
// if the address responds, it can have an id.
// if you have two addresses with the same id,
// only send messages to one of those.

// but given several addresses for a peer how do we decide which
// we should send to?

// hmm for multiple ports behind a nat it also matters which port we send _FROM_
// we need to send to an address that we have received packets from.

function Peer (addr) {
  return {
    address: addr.address,
//    addresss: []
    port: addr.port,
    id: addr.id,
    type: 0, //0=unknown, 1=static, 2=semistatic, 4=independent, 8=dependant
    recv: {ts: 0, count: 0},
    send: {ts: 0, count: 0},
    rtt: -1,
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

function getPeer (peers, info) {
  for(var i = 0; i < peers.length; i++)
    if(peers[i].address == info.address && peers[i].port === info.port)
      return peers[i]
  return null
}

function getOrAddPeer(peers, info) {
  var p = getPeer(peers, info)
  if(p) return p
  else p = Peer(info)
  //we might have first got the peer by a ping or something that didn't send
  //these details, so if we have these now, update them.
  p.type = p.type || info.type
  p.id = p.id || info.id

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
    getPeer: function (info) {
      return getPeer(peers, info)      
    },
    addPeer: function (info) {
      return addOrGetPeer(peers, info)
    },
    peers
  }

  socket.on('message', function (buf, rinfo, port) {
    if(isSelf(rinfo)) return
    var type = buf[0]
    var handler = handlers[type]
    if('function' === typeof handler) {
      handler(dht, buf, rinfo, port)
      var peer = getPeer(peers, rinfo)
      if(peer) {
        peer.recv.count ++
        peer.recv.ts = Date.now()
      }
    }
    else
      console.log('unknown message type:', type)
  })

  return dht

}

var TX_PING  = 0x12,
    RX_PING  = 0x13,
    TX_PEERS = 0x22,
    RX_PEERS = 0x23,
    TX_FORWARD = 0x32
 
function interval (fn, time) {
  setInterval(fn, time).unref()
  fn()
}

function createDHT (socket, seeds, id, base_port) {
  if(!base_port)
    throw new Error('must provide a base port')
//  var Ping = Buffer.from([PING])

  var Ping = Buffer.alloc(1+32)
  Ping[0] = TX_PING
  Ping.write(id, 1, 'hex')

//  var socket = dgram.createSocket('udp4')
  var me, me2
  var dht = createBase(id, socket, {
    [TX_PING]: function(dht, buf, peer) {
      if(port == 1999) dht.addPeer(peer)

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
      //if _me.port != port then we must be natted
      //but just because _me.port == port doesn't mean we are not natted.
      //to know for sure we must be able to receive an unsolicited packet
      //from another host.

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
      if(port == 1999) dht.addPeer(peer)
 
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
      //respond with self (to include id + type), plus known peers
      var b = Buffer.alloc(1+(_peers.length+1)*Ipv4Peer.bytes))
      b[0] = RX_PEERS
      Ipv4Peer.encode(me, b, 1)
      _peers.forEach((peer, i) => {
        Ipv4Peer.encode(peer, b, 1+(1+i)*Ipv4Peer.bytes)
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
    console.log('\033[2J\033[H')
    console.log(pretty(id, me, dht.peers))
  }
  interval(update, 5000)
}

module.exports = createDHT
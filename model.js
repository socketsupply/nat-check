
// 

/*
var network = {
  <ip>: {
    send: [{msg, addr}...],
    recv: [{msg, addr, port}],
  }
}
*/

function noop () {}

class Node {
  send = null;
  recv = null;
  constructor (fn) {
    this.send = []
    this.recv = []
    if(fn)
      this.onMessage = fn((msg, addr, port) => {
        this.send.push({msg, addr, port})
      })
  }
}

class Network extends Node {
  subnet = null
  constructor (prefix) {
    super()
    this.prefix = prefix
    this.subnet = {}
    this.map = {}
    this.unmap = {}
  }
  add (address, node) {
    this.subnet[address] = node
  }
  iterate (steps) {
    iterate(this.subnet, this.drop.bind(this), steps)
  }
  drop () {
    throw new Error('cannot send to outside address')
  }
  //msg, from, to
  onMessage ({msg, addr, port}) {
    throw new Error('cannot receive message')
  }
}

//endpoint independent nat - maps based on sender port.
class Nat extends Network {
  subnet = null
  constructor (prefix) {
    super()
    this.prefix = prefix || ''
    this.subnet = {}
    this.map = {}
    this.unmap = {}
  }
  add (address, node) {
    if(!address.startsWith(this.prefix))
      throw new Error('node address must start with prefix:'+this.prefix+', got:'+address)
    this.subnet[address] = node
  }
  iterate (steps) {
    return iterate(this.subnet, this.drop.bind(this), steps)
  }
  getPort () {
    return ~~(Math.random()*0xffff)
  }
  //subclasses must implement getKey
  drop (msg, dst, src) {
    var key = this.getKey(dst, src)
    var mapped = this.map[key]
    if(!mapped) {
      var port = this.getPort()
      this.map[key] = port
      this.unmap[port] = src
      this.send.push({msg, addr: dst, port: port})
    }
    else {
      this.send.push({msg, addr: dst, port: mapped})
    }
  }
  //msg, from, to
  onMessage (msg, addr, port) {
    //network has received an entire packet
    var dst = this.unmap[port]
    this.subnet[dst.address].recv.push({msg, addr, port: dst.port})
  }
}

class IndependentNat extends Nat {
  getKey (dst, src) {
    return src.address+':'+src.port
  }
}

class DependentNat extends Nat {
  getKey (dst, src) {
    return dst.address+':'+src.dst
  }
}



//iterate the network. steps=1 to do one set of message passes, -1 to run to completion
function iterate (subnet, drop, steps) {
  if(!subnet) throw new Error('iterate *must* be passed `network`')
  if(isNaN(steps)) throw new Error('steps must be number, use -1 to run til completion')
  while(steps--) {
    var changed = false
    for(var ip in subnet) {
      var node = subnet[ip]
      if(node.send.length) {
        var packet = node.send.shift()
        changed = true
        console.log("PACKET", packet)
        var dest = subnet[packet.addr.address]
        if(dest) {
          dest.recv.push({msg:packet.msg, addr: {address: ip, port: packet.port}, port: packet.addr.port})
        }
        else
          //{msg, addr: to, port: from}
          drop(packet.msg, packet.addr, {address: ip, port: packet.port})
      }
    }
    for(var ip in subnet) {
      var node = subnet[ip]
      if(node.recv.length && node.onMessage) {
        changed = true
        var packet = node.recv.shift()
        node.onMessage(packet.msg, packet.addr, packet.port)
      }
    }
    
    for(var ip in subnet) {
      var node = subnet[ip]
      if(node.subnet)
        changed = node.iterate(1) || changed

    }
    
    if(!changed) break;
  }
  return changed
}

module.exports = {iterate, Node, Network, IndependentNat}

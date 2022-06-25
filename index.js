#! /bin/env node

var PORT = 3489

function toAddress (addr) {
  return addr.address+':'+addr.port
}

function fromAddress (addr) {
  var [address, port] = addr.split(':')
  return {address, port: port || 3489}
}

function Server1 () {
  return function (send) {
    return function (msg, addr, port) {
      console.log('received msg:', msg, 'from:'+toAddress(addr))
      send({type: 'pong', addr, from: 's1'}, addr, port)
    }
  }
}

function Server2 (server3_addr) {
  if(!server3_addr)
    throw new Error('Server2 must be passed server3 ip')
  return function (send) {
    return function (msg, addr, port) {
      send({type: 'bounce', addr}, fromAddress(server3_addr), port)
      send({type: 'pong', addr, from: 's2'}, addr, port)
    }
  }
}

function Server3 () {
  return function (send) {
    return function (msg, addr, port) {
      send({type: 'bounce', from: 's3'}, msg.addr, port)
    }
  }
}

function Client (server1, server2, server3) {
  var s1, s2, s3, timer
  return function (send) {
    var start = Date.now()
    send({type:'ping'}, fromAddress(server1), PORT)
    send({type:'ping'}, fromAddress(server2), PORT)
    setTimeout(function () {
      if(!(s1||s2||s3))
        console.log('received no replies! you may be offline')
      process.exit(0)
    }, 5_000)

    return function (msg, addr, port) {
      var s = toAddress(addr)
      if(s === server1) {
        console.log('server1 response in:',Date.now() - start)
        s1 = msg
      }
      if(s === server2) {
        s2 = msg
        console.log('server2 response in:',Date.now() - start)
      }
      if(s === server3) {
        s3 = msg
        console.log('server3 response in:',Date.now() - start)
      }

      clearTimeout(timer)
      timer = setTimeout(function () {
        if(s1 && s2 && !s3) {
          if(s1.addr.address != s2.addr.address) {
            console.log('different addresses! (should never happen)')
            this.error = 'address mismatch'
          }
          if(s1.addr.port == s2.addr.port) {
            console.log('easy nat', toAddress(s1.addr))
            this.nat = 'easy'

            console.log('\nto connect to this peer:\n')
            console.log('> nat-check peer '+toAddress(s1.addr)+'    # from another easy nat peer')
            console.log('> nat-check db_hard '+toAddress(s1.addr)+' # from a hard nat peer')
          }
          else {
            console.log('hard nat', s1.addr.address+':{'+s1.addr.port+','+s2.addr.port+'}')
            this.nat = 'hard'
            console.log('\n  to connect to this peer:\n')
            console.log('> nat-check db_easy '+toAddress(s1.addr)+' # from another easy nat peer')
            console.log('  unfortunately, you cannot connect to this peer from another hard nat peer')
          }
        }
        else if(s3) {
          console.log('you have a *static address* that any peer can connect to directly!')
          console.log('\n  to connect to this peer:\n')
          console.log('> nat-check peer '+toAddress(s1.addr)+' # from any other peer')
          this.nat = 'static'
        }
      }, 300)
    }
  }
}

function Peer (remote, message) {
  var [address, port] = remote.split(':')
  return function (send) {
    setInterval(()=> {
      console.log('send...', remote)
      send({type: 'hello', ts: Date.now(), msg: message}, {address, port}, PORT)
    }, 1000)
    return function (msg, addr, port) {
      console.log('received:', msg, 'from:'+toAddress(addr))
    }
  }
}

function random_port (ports) {
  var r
  while(ports[r = ~~(Math.random()*0xffff)]);
  ports[r] = true
  return r
}

//easy side
function BirthdayEasy (remote, message) {
  var [address, port] = remote.split(':')
  var ports = {}, first = true
  var timer
  return function (send) {
    //send to ports until 
    var i = 1
    var int = setInterval(() => {
      var port = random_port(ports)
      console.log('bdhp->:', toAddres({address, port}))
      send({type:'hello', ts: Date.now(), msg: message, count: i++}, {address, port}, PORT)
    }, 10)
    return function (msg, addr, port) {
      if(first) {
        first = false
        console.log("successfully holepunched!", port+'->'+toAddress(addr), 'after:'+msg.count+' attempts')
      }
      console.log('received:', msg, 'from:'+port+'->'+toAddress(addr))
      clearInterval(int)

      timer = resend(timer, send, {type: "echo", addr, msg: message, count: msg.count}, addr, port)
    }
  } 
}

//a send function that will retransmit the message if the returned timer is not cleared
function resender(timer, send, msg, addr, port) {
  clearTimeout(timer)
  send(msg, addr, port)
  return setTimeout(() => {
    send(msg, addr, port)
  }, 2_000)

}

//hard side
function BirthdayHard (remote, message) {
  var [address, port] = remote.split(':')
  var ports = {}
  var first = true
  var timer
  return function (send) {
    for(var i = 0; i < 256; i++) {
      var p = random_port(ports)
      console.log('bdhp-<:', address+":"+p, i)
      send({type: 'hello', ts: Date.now(), msg: message}, {address, port}, p)
    }

    return function (msg, addr, port) {
      if(first) {
        first = false
        console.log("successfully holepunched!", port+'->'+toAddress(addr))
      }
      console.log('received:', msg, 'from:'+toAddress(addr))
      timer = resend(timer, send, {type: "echo", addr, msg: message, ts: Date.now(), count: (msg.count | 0) + 1}, addr, port)
    }
  }  
}

module.exports = {Server1, Server2, Server3, Client, BirthdayEasy, BirthdayHard}
var dgram = require('dgram')

function wrap (fn, ports, codec) {
  var onMessage
  var bound = {}
  function bind(p) {
    if(bound[p]) return bound[p]
    return bound[p] = dgram
      .createSocket('udp4')
      .bind(p)
      .on('message', (data, addr) => {
        onMessage(codec.decode(data), addr, p)
      })
      .on('error', (err) => {
        if(err.code === 'EACCES')
          console.log("could not bind port:"+err.port)
      })
  }

  ports.forEach(bind)
  onMessage = fn(function (msg, addr, from) {
    bind(from).send(codec.encode(msg), addr.port, addr.address)
  })
}

function Timer(server1) {
  var delay = 5_000, step = 10_000
  var port = 0, ts = Date.now()
  return function (send) {
    function ping () {
      send({type:"ping"}, {address: server1, port: PORT}, PORT)
    }
    ping()
    return function (msg) {
      console.log('port', port != msg.addr.port ? 'changed' : 'did not change', port, '->', msg.addr.port, 'after', (Date.now()-ts)/1_000, 'seconds')
      ts = Date.now()
      port = msg.addr.port
      setTimeout(ping, delay+=step)

    }
  }
}

if(!module.parent) {
  var defaults = ['3.25.141.150:3489','13.211.129.58:3489','3.26.157.68:3489']

  var json = {
    encode: (obj) => Buffer.from(JSON.stringify(obj)),
    decode: (buf) => JSON.parse(buf.toString())
  }

  function run(fn) {
    wrap(fn, [PORT], json)
  }

  var cmd = process.argv[2]
  var options = process.argv.slice(3)
  if(cmd === 'server1')      run(Server1())
  else if(cmd === 'server2') run(Server2(options[0] || defaults[1]))
  else if(cmd === 'server3') run(Server3())
  else if(cmd === 'client'
       || cmd == 'check')    run(Client(...(options.length ? options : defaults)))
  else if(cmd === 'timer')   run(Timer(options[0] || defaults[0]))
  else if(/$(db_.*)|(peer)/.test(cmd)) {
    if(!options[0])
      console.log('usage: nat-check '+cmd+' {remote ip:port} {message}')
    else if(cmd === 'bd_easy') run(BirthdayEasy(options[0], options[1]))
    else if(cmd === 'bd_hard') run(BirthdayHard(options[0], options[1]))
    else if(cmd === 'peer')    run(Peer(options[0], options[1]))
  }
  else console.log('usage: nat-check check|server1|server2 <server3_ip>|server3|bd_easy|bd_hard|timer')
}
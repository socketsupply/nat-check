#! /bin/env node

/*
  an implementation of the NAT-check program described in the paper:

"Peer-to-Peer Communication Across Network Address Translators" (Ford 2005)

6 Evaluation of Existing NATs

To evaluate the robustness of the TCP and UDP hole
punching techniques described in this paper on a variety
of existing NATs, we implemented and distributed a test
program called NAT Check [16], and solicited data from
Internet users about their NATs.
NAT Check’s primary purpose is to test NATs for the
two behavioral properties most crucial to reliable UDP
and TCP hole punching: namely, consistent identity-
preserving endpoint translation (Section 5.1), and silently
dropping unsolicited incoming TCP SYNs instead of re-
jecting them with RSTs or ICMP errors (Section 5.2). In
addition, NAT Check separately tests whether the NAT
supports hairpin translation (Section 5.4), and whether the
NAT filters unsolicited incoming traffic at all. This last
property does not affect hole punching, but provides a use-
ful indication the NAT’s firewall policy.
NAT Check makes no attempt to test every relevant
facet of NAT behavior individually: a wide variety of sub-
tle behavioral differences are known, some of which are
difficult to test reliably [12]. Instead, NAT Check merely
attempts to answer the question, “how commonly can the
proposed hole punching techniques be expected to work
on deployed NATs, under typical network conditions?”

6.1 Test Method

NAT Check consists of a client program to be run on a ma-
chine behind the NAT to be tested, and three well-known
servers at different global IP addresses. The client coop-
erates with the three servers to check the NAT behavior
relevant to both TCP and UDP hole punching. The client
Figure 8: NAT Check Test Method for UDP
program is small and relatively portable, currently run-
ning on Windows, Linux, BSD, and Mac OS X. The ma-
chines hosting the well-known servers all run FreeBSD.

6.1.1 UDP Test
To test the NAT’s behavior for UDP, the client opens a
socket and binds it to a local UDP port, then successively
sends “ping”-like requests to servers 1 and 2, as shown
in Figure 8. These servers each respond to the client’s
pings with a reply that includes the client’s public UDP
endpoint: the client’s own IP address and UDP port num-
ber as observed by the server. If the two servers report the
same public endpoint for the client, NAT Check assumes
that the NAT properly preserves the identity of the client’s
private endpoint, satisfying the primary precondition for
reliable UDP hole punching.
When server 2 receives a UDP request from the client,
besides replying directly to the client it also forwards the
request to server 3, which in turn replies to the client from
its own IP address. If the NAT’s firewall properly fil-
ters “unsolicited” incoming traffic on a per-session basis,
then the client never sees these replies from server 3, even
though they are directed at the same public port as the
replies from servers 1 and 2.
To test the NAT for hairpin translation support, the
client simply opens a second UDP socket at a different lo-
cal port and uses it to send messages to the public endpoint
representing the client’s first UDP socket, as reported by
server 2. If these messages reach the client’s first private
endpoint, then the NAT supports hairpin translation

---

NAT Check tests NATs for reliable UDP behavior
// /and TCP hole punching: consistent endpoint translation,
// and silently dropping unsolicited incoming TCP SYNs

NAT Check is a client program behind the NAT, 
servers at different global IP addresses.

To test the NAT’s behavior for UDP, the client opens a
socket and binds it to a local UDP port, then successively
sends “ping”-like requests to servers 1 and 2

servers 1 & 2 each reply with the client’s public UDP
ip and port.

If the two servers report the same public endpoint for the client,
Then the NAT preserves the identy of the client's private endpoint,
so holepunching should be easy.

Server 2 also forwards a message to server 3 which replies
to the client. If the client receives this message,
then the NAT does not filter "unsolicited" incoming traffic.

If the client has the same port in the responses from 1 and 2
then it's easy nat. if it receives the message from 3 it's semistatic.
if 1 and 2 have different ports it's a hard nat.

*/

var PORT = 3489

function Server1 () {
  return function (send) {
    return function (msg, addr, port) {
      send({type: 'pong', addr, from: 's1'}, addr, port)
    }
  }
}

function Server2 (server3_addr) {
  if(!server3_addr)
    throw new Error('Server2 must be passed server3 ip')
  return function (send) {
    return function (msg, addr, port) {
      send({type: 'bounce', addr}, {address: server3_addr, port: PORT}, port)
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
  var s1, s2, s3
  return function (send) {
    var start = Date.now()
    send({type:'ping'}, {address: server1, port: PORT}, PORT)
    send({type:'ping'}, {address: server2, port: PORT}, PORT)
    return function (msg, addr, port) {
      if(addr.address === server1) {
        console.log('server1 response in:',Date.now() - start)
        s1 = msg
      }
      if(addr.address === server2) {
        s2 = msg
        console.log('server1 response in:',Date.now() - start)
      }
      if(addr.address === server3) {
        s3 = msg
        console.log('server3 response in:',Date.now() - start)
      }

      if(s1 && s2) {
        if(s1.addr.address != s2.addr.address) {
          console.log('different addresses! (should never happen)')
          this.error = 'address mismatch'
        }
        if(s1.addr.port == s2.addr.port) {
          console.log('easy nat', s1.addr.address+':'+s1.addr.port)
          this.nat = 'easy'
        }
        else {
          console.log('hard nat', s1.addr.address+':{'+s1.addr.port+','+s2.addr.port+'}')
          this.nat = 'hard'
        }
      }
      if(s3) {
        console.log('static address', s3.addr)
        this.nat = 'static'
      }
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
      console.log('received:', msg)
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
  var ports = {}
  return function (send) {
    //send to ports until 
    var int = setInterval(function () {
      var p = random_port(ports)
      console.log('bdhp->:', address+":"+p)
      send({type:'hello', ts: Date.now(), msg: message}, {address: address, port: p}, PORT)
    }, 10)
    return function (msg, addr, port) {
      console.log('received:', msg)
      clearInterval(int)
      send({type: "echo", addr, msg: message}, addr, port)
    }
  } 
}

//hard side
function BirthdayHard (remote, message) {
  var [address, port] = remote.split(':')
  var ports = {}
  return function (send) {
    for(var i = 0; i < 256; i++) {
      var p = random_port(ports)
      console.log('bdhp-<:', address+":"+p)
      send({type: 'hello', ts: Date.now(), msg: message}, {address, port}, p)
    }
    return function (msg, addr, port) {
      console.log('received:', msg)
      send({type: "echo", addr, msg: message}, addr, port)
    }
  }  
}

module.exports = {Server1, Server2, Server3, Client}
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
    //console.log('SEND', codec.encode(msg), addr, from)
    bind(from).send(codec.encode(msg), addr.port, addr.address)
  })
}

if(!module.parent) {
  var defaults = ['3.25.141.150','13.211.129.58','3.26.157.68']

  var json = {
    encode: (obj) => Buffer.from(JSON.stringify(obj)),
    decode: (buf) => JSON.parse(buf.toString())
  }

  var cmd = process.argv[2]
  var options = process.argv.slice(3)
  if(cmd === 'server1') wrap(Server1(), [PORT], json)
  else if(cmd === 'server2') wrap(Server2(options[0] || defaults[1]), [PORT], json)
  else if(cmd === 'server3') wrap(Server3(), [PORT], json)
  else if(cmd === 'client') {
    wrap(Client(...(options.length ? options : defaults)), [PORT], json)
    setTimeout(function () {
      process.exit(0)
    }, 5_000)
  }
  else if(cmd === 'peer') {
    if(!options[0]) {
      console.error('usage: nat-check peer {remote ip:port}')
      process.exit(1)
    }
    wrap(Peer(options[0], options[1]), [PORT], json)
  }
  else if(cmd === 'bd_easy') {
    wrap(BirthdayEasy(options[0], options[1]), [PORT], json)

  }
  else if(cmd === 'bd_hard') {
    wrap(BirthdayHard(options[0], options[1]), [PORT], json)


  }
  else console.log('usage: nat-check client|server1|server2 <server3_ip>|server3')

}
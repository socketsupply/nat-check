var {iterate, Node, Network, IndependentNat, IndependentFirewallNat, DependentNat} = require('../model')
var network = new Network()

var test = require('tape')
function noop () {}

function assertFinished (t, network) {
  for(var ip in network.subnet) {
    t.deepEqual(network.subnet[ip].send, [])
    t.deepEqual(network.subnet[ip].recv, [])
  }
}

test('echo', function (t) {
//  t.plan(2)
//  console.log(network)
  var a = 'a.a.a.a'
  var b = 'b.b.b.b'
  var received = false
  function createBPeer (send) {
    send('hello', {address: a, port: 10}, 1)
    return function onMessage (msg, addr, port) {
      t.equal(msg, 'hello')
      t.equal(port, 1)
    }
  }
  //echo the received message straight back.
  function createAPeer (send) {
    return function onMessage (msg, addr, port) {
      received = true
      t.equal(msg, 'hello')
      t.equal(port, 10)
      send(msg, addr, port)
    }
  }

//  network[a] = createNode(createAPeer)
//  network[b] = createNode(createBPeer)
  network.add(a,  new Node(createAPeer))
  network.add(b,  new Node(createBPeer))
  console.log(network)
//  network[b] = createNode(createBPeer)
  network.iterate(-1)
  t.equal(received, true)
  assertFinished(t, network)
//  console.log(JSON.stringify(network, null, 2))
  t.end()
})


test('echo relay', function (t) {
  var network = new Network()
//  t.plan(2)
  var a = 'a.a.a.a'
  var b = 'b.b.b.b'
  var c = 'c.c.c.c'
  var received = false
  function createBPeer (send) {
    send({msg:'hello', forward: {address: a, port: 10}}, {address: c, port: 3}, 1)
    return function onMessage (msg, addr, port) {
      t.equal(msg, 'hello')
      t.equal(port, 1)
    }
  }
  //echo the received message straight back.
  function createAPeer (send) {
    return function onMessage (msg, addr, port) {
      received = true
      t.equal(msg, 'hello')
      t.equal(port, 10)
      t.equal(addr.address, c)
      t.equal(addr.port, 3)
      send({msg:msg, forward: {address:b, port: 1}}, addr, port)
    }
  }

  function createCPeer (send) {
    return function onMessage (msg, addr, port) {
      t.equal(port, 3)
      send(msg.msg, msg.forward, port)
    }
  }

//  network[a] = createNode(createAPeer)
//  network[b] = createNode(createBPeer)
//  network[c] = createNode(createCPeer)
  network.add(a, new Node(createAPeer))
  network.add(b, new Node(createBPeer))
  network.add(c, new Node(createCPeer))
  network.iterate(-1)
  t.equal(received, true, 'received message')
  assertFinished(t, network)
  t.end()
})
//return
test('nat', function (t) {
  var echos = 0, received = false
  var network = new Network()
  var A = 'aa.aa.aa.aa'
  var B = 'bb.bb.bb.bb'
  var a = 'a.a.a.a'
  //publically accessable echo server
  network.add(A, new Node((send) => (msg, addr, port) => {
    echos++;
    console.log("ECHO:", msg, addr, port)
    //received address should be the nat's external address & the mapped port
    t.notEqual(addr.port, 1)
    t.equal(addr.address, B)
    send(msg, addr, port)
  }))
  //var nat = network[B] = createNat('a.a.')
  var nat
  network.add(B, nat = new IndependentNat('a.a'))
  //nat.subnet = subnetwork

  nat.add(a, new Node((send) => {
    var hello = "HELLO FROM SUBNET"
    send(hello, {address: A, port: 10}, 1)
    return (msg, addr, port) => {
      t.equal(msg, hello)
      //received address should be the external server's real address
      t.deepEqual(addr, {address: A, port: 10})
      received = true
    }
  }))

  network.iterate(-1)
  console.log(JSON.stringify(network, null, 2))
  t.ok(received)
  t.equal(echos, 1)
  t.end()
})

test('nat must be opened by outgoing messages', function (t) {

  var echos = 0, received = false, dropped = false
  var network = new Network()
  network.drop = function () {
    dropped = true
  }
  var A = 'aa.aa.aa.aa'
  var B = 'bb.bb.bb.bb'
  var a = 'a.a.a.a'
  //publically accessable echo server
  network.add(A, new Node((send) => {
    send("ANYONE HOME?", B, 1)
    return (msg, addr, port) => {}
  }))
  //var nat = network[B] = createNat('a.a.')
  var nat
  network.add(B, nat = new IndependentNat('a.a'))
  //nat.subnet = subnetwork

  nat.add(a, new Node((send) => (msg, addr, port) => {
    received = true
  }))

  network.iterate(-1)
  t.equal(received, false)
  t.equal(dropped, true)
  t.end()

})

test('nat (no firewall) must be opened by outgoing messages', function (t) {

  var echos = 0, received = false, dropped = false
  var network = new Network()
  network.drop = function () {
    dropped = true
  }
  var A = 'aa.aa.aa.aa'
  var B = 'bb.bb.bb.bb'
  var C = 'cc.cc.cc.cc'
  var a = 'a.a.a.a'
  var b = 'b.b.b.b'

  //publically accessable rendevu server.
  //sends the source address back, so the natted'd peer knows it's external address
  network.add(C, node_c = new Node((send) => {
    send("ANYONE HOME?", B, 1)
    return (msg, addr, port) => {
      console.log("ECHO ADDR", {msg, addr, port})
      send(addr, addr, port)
    }
  }))
  var nat_A, nat_B, received_a = [], received_b = []
  network.add(B, nat_B = new IndependentNat('b.b.'))
  network.add(A, nat_A = new IndependentNat('a.a.'))
  //nat.subnet = subnetwork

  nat_A.add(a, node_a = new Node((send) => (msg, addr, port) => {
    received_a.push({msg, addr, port})
  }))
  nat_B.add(b, node_b = new Node((send) => {
    (msg, addr, port) => {     
      received_b.push({msg, addr, port})
    }
  }))

  /*
  A ---------------> C
    <----,
         |
         |
  B -----`


  Alice opens an out going port by sending to C
  Bob can then send a message to that port.

  since only the port on the incoming packet is checked
  (and not the address) it goes through.
  Alice can now reply to B, by responding to that message.

  This means Alice has an empheral address, but any one can connect with her.
  It's the simplest kind of NAT because the port only has to be opened once.
  It's a NAT but no firewall
  */


  //Alice opens a port, by messaging the intro server C.
  node_a.send.push({msg: "A->C", addr: {address: C, port: 1}, port: 10}) 
  network.iterate(-1)

  t.ok(received_a.length)

  var echo = received_a.shift()
  t.deepEqual(echo.addr, {address:C, port: 1})
  t.equal(echo.msg.address, A)
  t.notEqual(echo.msg.port, 10)

  //Bob holepunches to Alice by sending to the port opened by previous message
  node_b.send.push({msg: "B-(holepunch)->A", addr: {address: A, port: echo.msg.port}, port: 20}) 
  network.iterate(-1)
  t.ok(received_a.length)
  var holepunch = received_a.shift()
  t.equal(holepunch.msg, "B-(holepunch)->A")
  t.equal(holepunch.addr.address, B)
  t.notEqual(holepunch.addr.port, 20)

  t.end()

})


test('nat (with firewall) must be opened by outgoing messages direct to peer', function (t) {

  var echos = 0, received = false, dropped = false
  var network = new Network()
  network.drop = function () {
    dropped = true
  }
  var A = 'aa.aa.aa.aa'
  var B = 'bb.bb.bb.bb'
  var C = 'cc.cc.cc.cc'
  var a = 'a.a.a.a'
  var b = 'b.b.b.b'

  //publically accessable rendevu server.
  //sends the source address back, so the natted'd peer knows it's external address
  network.add(C, node_c = new Node((send) => {
    send("ANYONE HOME?", B, 1)
    return (msg, addr, port) => {
      console.log("ECHO ADDR", {msg, addr, port})
      send(addr, addr, port)
    }
  }))
  var nat_A, nat_B, received_a = [], received_b = []
  network.add(B, nat_B = new IndependentFirewallNat('b.b.'))
  network.add(A, nat_A = new IndependentFirewallNat('a.a.'))
  //nat.subnet = subnetwork

  nat_A.add(a, node_a = new Node((send) => (msg, addr, port) => {
    received_a.push({msg, addr, port})
  }))
  nat_B.add(b, node_b = new Node((send) => (msg, addr, port) => {     
    received_b.push({msg, addr, port})
  }))

  /*

  A a--------> C
  x|
  ^|
  ||
  ov
  B


  Alice opens an out going port by sending to C
  Bob sends a message to that port, to open their firewall


  since only the port on the incoming packet is checked
  (and not the address) it goes through.
  Alice can now reply to B, by responding to that message.

  This means Alice has an empheral address, but any one can connect with her.
  It's the simplest kind of NAT because the port only has to be opened once.
  It's a NAT but no firewall
  */


  //Alice opens a port, by messaging the intro server C.
  node_a.send.push({msg: "A->C", addr: {address: C, port: 1}, port: 10}) 
  node_b.send.push({msg: "A->B", addr: {address: C, port: 1}, port: 10}) 
  network.iterate(-1)

  t.ok(received_a.length)
  t.ok(received_b.length)
  
  var echo_a = received_a.shift()
  var echo_b = received_b.shift()
  t.deepEqual(echo_a.addr, {address:C, port: 1})
  t.equal(echo_a.msg.address, A)
  t.notEqual(echo_a.msg.port, 10)

  t.deepEqual(nat_B.firewall, {
    [C+':1']: true,
  })


  //Bob opens a port for alice by sending a packet to her, but Alice's firewall does not let it through
  node_b.send.push({msg: "B-(holepunch)->A", addr: {address: A, port: echo_a.msg.port}, port: 10}) 
  network.iterate(-1)

  //this message did not get through but it did open B's firewall
  t.equal(received_a.length, 0)
  t.equal(received_b.length, 0)

  t.deepEqual(nat_B.firewall, {
    [C+':1']: true,
    [A+':'+echo_a.msg.port]: true
  })


  //Alice holepunches to Body by sending to the port opened found from C, through the hole opened
  //by Bob's by previous message
  node_a.send.push({msg: "A-(holepunch)->B", addr: {address: B, port: echo_b.msg.port}, port: 10}) 
  network.iterate(-1)

  t.equal(received_b.length, 1)

  //Bob can now send to Alice
  node_b.send.push({msg: "B-(holepunch)->A", addr: {address: A, port: echo_a.msg.port}, port: 10}) 
  network.iterate(-1)

  t.equal(received_a.length, 1)

  t.end()
})


test('one side dependent nat requires birthday paradox', function (t) {

  var echos = 0, received = false, dropped = false
  var network = new Network()
  network.drop = function () {
    dropped = true
  }

  var A = 'aa.aa.aa.aa'
  var B = 'bb.bb.bb.bb'
  var C = 'cc.cc.cc.cc'
  var a = 'a.a.a.a'
  var b = 'b.b.b.b'

  //publically accessable rendevu server.
  //sends the source address back, so the natted'd peer knows it's external address
  network.add(C, node_c = new Node((send) => {
    send("ANYONE HOME?", B, 1)
    return (msg, addr, port) => {
      console.log("ECHO ADDR", {msg, addr, port})
      send(addr, addr, port)
    }
  }))

  var nat_A, nat_B, received_a = [], received_b = []
  network.add(B, nat_B = new DependentNat('b.b.')) //AKA Symmetric NAT
  network.add(A, nat_A = new IndependentFirewallNat('a.a.'))
  //nat.subnet = subnetwork

  nat_A.add(a, node_a = new Node((send) => (msg, addr, port) => {
    received_a.push({msg, addr, port})
  }))
  nat_B.add(b, node_b = new Node((send) => (msg, addr, port) => {     
    received_b.push({msg, addr, port})
  }))


  //Alice opens a port, by messaging the intro server C.
  node_a.send.push({msg: "A->C", addr: {address: C, port: 1}, port: 10}) 
//  node_b.send.push({msg: "A->B", addr: {address: C, port: 1}, port: 10}) 
  network.iterate(-1)

  t.ok(received_a.length)
//  t.ok(received_b.length)
  
  var echo_a = received_a.shift()
//  var echo_b = received_b.shift()
  t.deepEqual(echo_a.addr, {address:C, port: 1})
  t.equal(echo_a.msg.address, A)
  t.notEqual(echo_a.msg.port, 10)

  function create_rand_port () {
    var ports = {}
    return function () {
//      return ~~(Math.random() * 0xffff)
      while(ports[r = ~~(Math.random() * 0xffff)]);
      ports[r] = true
      return r
    }
  }
  var N = 64
  //B (Endpoint Dependant / Symmetrical Nat) opens 256 ports
  var rand_port = create_rand_port()
  for(var i = 0; i < N; i++) {
    node_b.send.push({msg: "B-(hb:holepunch)->A", addr: {address: A, port: echo_a.msg.port}, port: rand_port()}) 
  }

  network.iterate(-1)
  t.equal(received_a.length, 0)

  
  var rand_port = create_rand_port()
  var tries = 0
  while(!received_b.length) {
    for(var i = 0; i < N; i++) {
      node_a.send.push({msg: "B-(hb:holepunch)->A", addr: {address: B, port: rand_port()}, port: 10}) 
    }
    //console.log("ITERATE")
    tries += N
    network.iterate(-1)
  }
  console.log("connected after:", tries)
  t.notEqual(received_b.length, 0)
  received_a = []
  while(received_b.length) {
    var echo = received_b.shift()
    node_b.send.push({msg: "echo:"+echo.msg, addr: echo.addr, port: echo.port})
    network.iterate(-1)
    t.equal(received_a.shift().msg, "echo:"+echo.msg)
  }
  t.end()
})

//to make a connection between two 

var test = require('tape')


var {Node, Network, IndependentNat, IndependentFirewallNat, DependentNat} = require('../model')
var nc = require('../nat-check')


var A = 'aa.aa.aa.aa'
var B = 'bb.bb.bb.bb'
var C = 'cc.cc.cc.cc'
var D = 'dd.dd.dd.dd'
var d = 'd.d.d.d'

test('client is public server', function (t) {

  var network = new Network()
  var client
  network.add(A, new Node(nc.Server1()))
  network.add(B, new Node(nc.Server2(C)))
  network.add(C, new Node(nc.Server3()))
  network.add(D, client = new Node(nc.Client(A,B,C)))
  network.iterate(-1)

  console.log(client)
  t.equal(client.nat, "static")

  t.end()
})


test('client behind independent nat', function (t) {

  var network = new Network(), nat = new IndependentNat('d.')
  var client
  network.add(A, new Node(nc.Server1()))
  network.add(B, new Node(nc.Server2(C)))
  network.add(C, new Node(nc.Server3()))
  network.add(D, nat)
  nat.add(d, client = new Node(nc.Client(A,B,C)))
  network.iterate(-1)

  console.log(client)
  t.equal(client.nat, "static")

  t.end()
})

test('client behind independent firewall nat', function (t) {

  var network = new Network(), nat = new IndependentFirewallNat('d.')
  var client
  network.add(A, new Node(nc.Server1()))
  network.add(B, new Node(nc.Server2(C)))
  network.add(C, new Node(nc.Server3()))
  network.add(D, nat)
  nat.add(d, client = new Node(nc.Client(A,B,C)))
  network.iterate(-1)

  console.log(client)
  t.equal(client.nat, "easy")

  t.end()
})


test('client behind dependant nat', function (t) {

  var network = new Network(), nat = new DependentNat('d.')
  var client
  network.add(A, new Node(nc.Server1()))
  network.add(B, new Node(nc.Server2(C)))
  network.add(C, new Node(nc.Server3()))
  network.add(D, nat)
  nat.add(d, client = new Node(nc.Client(A,B,C)))
  network.iterate(-1)

  console.log(client)
  t.equal(client.nat, "hard")

  t.end()
})

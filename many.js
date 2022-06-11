var dgram = require('dgram')
var EventEmitter = require('events')
exports.createSocket = function (type) {
  //var socket
  var sockets = [], map = {}
  var emitter = new EventEmitter()

  emitter.bind = function (ports) {
    if(!Array.isArray(ports)) ports = [ports]
    sockets = ports.map(p => {
      return map[p] = dgram.createSocket(type)
      .bind(p)
      .on('message', (b, from) => {
        emitter.emit('message', b, from, p)
      })
    })
    return emitter
  }
  emitter.send = function (msg, port, address, from_port) {
    return (from_port ? map(from_port) : sockets[0]).send(msg, port, address)
  }

  return emitter
}
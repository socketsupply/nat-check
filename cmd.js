var createDHT = require('./')
if(!module.parent) {
  var PORT = 1999
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
  socket.bind([PORT, PORT+1])
 // setTimeout(function () {
 //   socket.setBroadcast(true)
 // }, 1000)
  createDHT(socket, seeds, id, PORT)
  
}
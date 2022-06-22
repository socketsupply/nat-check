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
    buffer.writeUInt16LE(peer.type, start+Ipv4.bytes)
    if(peer.id)
      buffer.write(peer.id, start+Ipv4.bytes+2, 'hex')
    return Ipv4Peer.bytes + 2 + 32
  },
  decode: function (buffer, start) {
    var peer = Ipv4.decode(buffer, start)
    peer.type = Buffer.readUInt16LE(6)
    peer.id = buffer.toString('hex', 8, 8+32)
    return peer
  },
  bytes: Ipv4.bytes + 2 + 32
}

module.exports = {Ipv4, Ipv4Peer}
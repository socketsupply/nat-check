

function pretty (id, me, peers) {
  var padding = [10, 20, -5, -5, -7, -6]

  var ts = Date.now()
  var table = peers.map(e => {
    return [
      e.id && e.id.substring(0, 8),
      addr2String(e),
      e.send.count,
      e.recv.count,
      e.rtt,
      e.recv.ts ? niceAgo(ts, e.recv.ts) : 'na'
    ]
  })

  return [
 // console.log('\033[2J\033[H')
    ('My ip:', me ? addr2String(me) : 'unknown'),
    ('id:', id),
    ('Time:'+new Date().toISOString()),
    ('\n'),
//  console.log(
    [['Id', 'ip', 'Send', 'Recv', 'RTT', 'alive'], ...table]
    .map(row => {
      return row.map((e, i) => (
        padding[i] < 0
        ? (e||'').toString().padStart(padding[i] * -1, ' ')
        : (e||'').toString().padEnd(padding[i], ' ')
      )).join('')
    }).join('\n')
  ].join('\n')
  //)
}

function addr2String(p) {
  return p.address+':'+p.port
}


module.exports = {pretty, addr2String}
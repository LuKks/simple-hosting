const fs = require('fs')

module.exports = function watchFile (filename, callback) {
  let prev = statSync(filename)
  let closed = false
  let timeout = null

  loop()

  return function () {
    closed = true
    if (timeout !== null) clearTimeout(timeout)
  }

  function loop () {
    fs.stat(filename, function (err, st) { // eslint-disable-line n/handle-callback-err
      if (closed) return

      if (!same(prev, st)) {
        callback(filename, !!st)
      }

      prev = st
      timeout = setTimeout(loop, 2000)
    })
  }
}

function same (a, b) {
  if (!a && !b) return true

  if ((a && !b) || (!a && b)) return false

  return a.mtime.getTime() === b.mtime.getTime() &&
    a.ctime.getTime() === b.ctime.getTime()
}

function statSync (filename) {
  try {
    return fs.statSync(filename)
  } catch {
    return null
  }
}

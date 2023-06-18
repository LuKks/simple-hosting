const tls = require('tls')
const http = require('http')
const https = require('https')
const fs = require('fs')
const httpProxy = require('http-proxy')
const reduceUA = require('reduce-user-agent')
const graceful = require('graceful-http')
const crayon = require('tiny-crayon')
const isCloudFlare = require('./lib/is-cloudflare.js')

class Hosting {
  constructor (opts = {}) {
    this.apps = new Map()

    this.log = !!opts.log
    this.behindProxy = opts.behindProxy

    this.proxy = httpProxy.createProxyServer()
    this.proxy.on('error', this._onerror.bind(this))

    this.insecureServer = http.createServer()
    this.secureServer = https.createServer({ SNICallback: this._SNICallback.bind(this) })

    this.insecureServerClose = graceful(this.insecureServer)
    this.secureServerClose = graceful(this.secureServer)

    this.insecureServer.on('request', this._onrequest.bind(this, this.insecureServer))
    this.secureServer.on('request', this._onrequest.bind(this, this.secureServer))
  }

  add (servername, opts = {}) {
    if (this.apps.has(servername)) throw new Error('App already exists')
    if (!opts.destination) throw new Error('Destination is required')

    this.apps.set(servername, {
      secureContext: opts.cert && opts.key ? createSecureContext(opts.cert, opts.key) : null,
      destination: opts.destination
    })
  }

  edit (servername, opts = {}) {
    if (!this.apps.has(servername)) throw new Error('App does not exist')

    const app = this.apps.get(servername)

    if (opts.cert && opts.key) app.secureContext = createSecureContext(opts.cert, opts.key)
    if (opts.destination) app.destination = opts.destination
  }

  listen () {
    this.insecureServer.listen(80)
    this.secureServer.listen(443)
  }

  async close () {
    await Promise.all([
      this.insecureServerClose(),
      this.secureServerClose()
    ])
    this.proxy.close()
  }

  _SNICallback (servername, cb) {
    const app = this.apps.get(servername)

    if (this.log) console.log('SNI:', servername, 'App found?', !!app)

    if (app && app.secureContext) {
      cb(null, app.secureContext)
      return
    }

    cb()
  }

  _onrequest (server, req, res) {
    const app = this.apps.get(req.headers.host)

    if (this.log) this._logRequest(req, app)

    if (this.behindProxy === 'cf' && !isCloudFlare(req.connection.remoteAddress)) {
      res.connection.destroy()
      return
    }

    if (!app) {
      res.connection.destroy()
      return
    }

    if (this.insecureServer === server && app.secureContext) {
      res.writeHead(301, { Location: 'https://' + req.headers.host + req.url })
      res.end()
      return
    }

    /* if (app.www && req.headers.host.indexOf('www.') === -1) {
      res.writeHead(301, { Location: 'https://www.' + req.headers.host + req.url })
      res.end()
      return
    } */

    // TODO: ideally manual forward it without http-proxy
    this.proxy.web(req, res, { target: app.destination })
  }

  _onerror (err, req, res) {
    if (err.code === 'ECONNREFUSED') {
      res.writeHead(521, { 'Content-Type': 'text/plain' })
      res.end('Web server is down.')
      return
    }

    // Temporarily log unknown errors to catch the common ones like timeout, etc
    console.error(err)

    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Internal error.')
  }

  _getRemoteAddress (req) {
    if (this.behindProxy === 'cf' && !isCloudFlare(req.connection.remoteAddress)) {
      return req.connection.remoteAddress
    }

    if (this.behindProxy) return (req.headers['x-forwarded-for'] || '').split(',').shift()

    return req.connection.remoteAddress
  }

  _logRequest (req, app) {
    const remoteAddress = this._getRemoteAddress(req)
    const remoteCountry = this.behindProxy === 'cf' && isCloudFlare(req.connection.remoteAddress) ? req.headers['cf-ipcountry'] : null

    const o = crayon.gray(crayon.bold('['))
    const c = crayon.gray(crayon.bold(']'))

    console.log(
      '- Request',
      o + crayon.white((new Date().toLocaleString('en-GB'))) + c,
      o + crayon.yellow(remoteAddress), crayon.gray(remoteCountry || 'null') + c,
      // req.headers,
      o + (app ? crayon.green('OK') : crayon.red('ERR')), crayon.cyan(req.headers.host), crayon.yellow(req.method), crayon.magenta(req.url) + c,
      // req.body,
      crayon.gray(reduceUA(req.headers['user-agent']))
    )
  }
}

module.exports = Hosting

function createSecureContext (cert, key) {
  // TODO: should be async
  return tls.createSecureContext({
    cert: fs.readFileSync(cert), // => fullchain.pem
    key: fs.readFileSync(key) // => privkey.pem
  })
}

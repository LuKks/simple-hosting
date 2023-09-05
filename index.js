const tls = require('tls')
const http = require('http')
const https = require('https')
const fs = require('fs')
const httpProxy = require('http-proxy')
const reduceUA = require('reduce-user-agent')
const graceful = require('graceful-http')
const crayon = require('tiny-crayon')
const listen = require('./lib/listen.js')

module.exports = class Hosting {
  constructor (opts = {}) {
    this.apps = new Map()

    this.log = !!opts.log
    this.behindProxy = opts.behindProxy
    this.auth = opts.auth

    this.proxy = httpProxy.createProxyServer()
    this.proxy.on('error', this._onproxyerror.bind(this))
    this.proxy.on('proxyReq', this._onproxyreq.bind(this))

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
      destination: opts.destination,
      location: opts.location || null
    })
  }

  edit (servername, opts = {}) {
    if (!this.apps.has(servername)) throw new Error('App does not exist')

    const app = this.apps.get(servername)

    if (opts.cert && opts.key) app.secureContext = createSecureContext(opts.cert, opts.key)
    if (opts.destination) app.destination = opts.destination
    if (opts.location) app.location = opts.location
  }

  async listen (opts = {}) {
    await Promise.all([
      listen(this.insecureServer, opts.insecurePort || 80),
      opts.securePort !== false ? listen(this.secureServer, opts.securePort || 443) : null
    ])
  }

  async close () {
    await Promise.all([
      this.insecureServerClose(),
      this.secureServer.listening ? this.secureServerClose() : null
    ])
    this.proxy.close()
  }

  _SNICallback (servername, cb) {
    const app = this.apps.get(servername)

    if (this.log) console.log('- SNI:', servername, 'App found?', !!app)

    if (app && app.secureContext) {
      cb(null, app.secureContext)
      return
    }

    cb()
  }

  _onrequest (server, req, res) {
    const app = this.apps.get(req.headers.host)

    if (this.log) this._logRequest(req, app)

    if (!app || !this._isAuthenticated(req)) {
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

    if (app.location) {
      for (const pathname in app.location) {
        const destination = app.location[pathname]

        // TODO: Use path-to-regexp lib
        if (req.url.startsWith(pathname)) {
          this.proxy.web(req, res, { target: destination, server })
          return
        }
      }
    }

    // TODO: ideally manual forward it without http-proxy
    this.proxy.web(req, res, { target: app.destination, server })
  }

  _onproxyreq (proxyReq, req, res, options) {
    proxyReq.removeHeader('x-simple-hosting')

    if (!this.behindProxy) {
      const remoteAddress = this._getRemoteAddress(req)

      proxyReq.removeHeader('Forwarded')
      proxyReq.removeHeader('X-Forwarded-Host')
      proxyReq.setHeader('X-Forwarded-For', remoteAddress)
      proxyReq.setHeader('X-Forwarded-Proto', this.insecureServer === options.server ? 'http' : 'https')
    }
  }

  _onproxyerror (err, req, res) {
    if (err.code === 'ECONNRESET') {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end('Web server closed the connection unexpectedly.')
      return
    }

    if (err.code === 'ECONNREFUSED') {
      res.writeHead(503, { 'Content-Type': 'text/plain' })
      res.end('Web server is down.')
      return
    }

    if (err.code === 'ETIMEDOUT') {
      res.writeHead(504, { 'Content-Type': 'text/plain' })
      res.end('Web server timed out.')
      return
    }

    console.error(err) // Temporarily log rare errors

    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Internal error.')
  }

  _isAuthenticated (req) {
    return !this.auth || this.auth === req.headers['x-simple-hosting']
  }

  _getRemoteAddress (req) {
    if (!this.behindProxy) return req.connection.remoteAddress

    if (!this._isAuthenticated(req)) return req.connection.remoteAddress

    return (req.headers['x-forwarded-for'] || '').split(',').shift()
  }

  _logRequest (req, app) {
    const remoteAddress = this._getRemoteAddress(req)
    const remoteCountry = this.behindProxy === 'cf' && this.auth && this._isAuthenticated(req) ? req.headers['cf-ipcountry'] : null

    const o = crayon.gray(crayon.bold('['))
    const c = crayon.gray(crayon.bold(']'))

    console.log(
      '- Request',
      o + crayon.white((new Date().toLocaleString('en-GB'))) + c,
      o + (this._isAuthenticated(req) ? crayon.green('OK') : crayon.red('ERR')), crayon.yellow(remoteAddress), crayon.gray(remoteCountry || 'null') + c,
      // req.headers,
      o + (app ? crayon.green('OK') : crayon.red('ERR')), crayon.cyan(req.headers.host), crayon.yellow(req.method), crayon.magenta(req.url) + c,
      // req.body,
      crayon.gray(reduceUA(req.headers['user-agent']))
    )
  }
}

function createSecureContext (cert, key) {
  // TODO: should be async
  return tls.createSecureContext({
    cert: fs.readFileSync(cert), // => fullchain.pem
    key: fs.readFileSync(key) // => privkey.pem
  })
}

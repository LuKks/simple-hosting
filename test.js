const test = require('brittle')
const http = require('http')
const fetch = require('like-fetch')
const Hosting = require('./index.js')
const listen = require('./lib/listen.js')

test('basic', async function (t) {
  t.plan(6)

  const hosting = new Hosting()
  hosting.add('a.leet.ar', { destination: 'http://127.0.0.1:1337' })
  hosting.add('b.leet.ar', { destination: 'http://127.0.0.1:3000' })
  await hosting.listen({ insecurePort: 8080, securePort: false })

  const app1 = await createServer(1337, (req, res) => res.end('Hello'))
  const app2 = await createServer(3000, (req, res) => res.end('World'))

  const a = await fetch('http://127.0.0.1:8080', { headers: { host: 'a.leet.ar' } })
  t.is(a.status, 200)
  t.is(await a.text(), 'Hello')

  const b = await fetch('http://127.0.0.1:8080', { headers: { host: 'b.leet.ar' } })
  t.is(b.status, 200)
  t.is(await b.text(), 'World')

  app1.close()
  app2.close()

  const c = await fetch('http://127.0.0.1:8080', { headers: { host: 'a.leet.ar' } })
  t.is(c.status, 521)

  const d = await fetch('http://127.0.0.1:8080', { headers: { host: 'b.leet.ar' } })
  t.is(d.status, 521)

  await hosting.close()
})

test('request to non-existing app', async function (t) {
  t.plan(1)

  const hosting = new Hosting()
  await hosting.listen({ insecurePort: 8080, securePort: false })

  try {
    await fetch('http://127.0.0.1:8080', { headers: { host: 'a.leet.ar' } })
    t.fail('Should have failed')
  } catch (err) {
    t.is(err.code, 'ECONNRESET')
  }

  await hosting.close()
})

test('forwarded headers', async function (t) {
  t.plan(6)

  const hosting = new Hosting()
  hosting.add('a.leet.ar', { destination: 'http://127.0.0.1:1337' })
  await hosting.listen({ insecurePort: 8080, securePort: false })

  const app = await createServer(1337, function (req, res) {
    t.is(req.headers['x-forwarded-for'], '::ffff:127.0.0.1')
    t.is(req.headers['x-forwarded-host'], undefined)
    t.is(req.headers['x-forwarded-proto'], 'http')
    t.is(req.headers['x-custom-header'], '123')
    res.end('Hello')
  })

  const a = await fetch('http://127.0.0.1:8080', {
    headers: {
      host: 'a.leet.ar',
      // Spoofing attempt
      'x-forwarded-for': '1.2.3.4',
      'x-forwarded-host': 'random.leet.ar',
      'x-forwarded-proto': 'https',
      // Custom headers
      'x-custom-header': '123'
    }
  })
  t.is(a.status, 200)
  t.is(await a.text(), 'Hello')

  app.close()

  await hosting.close()
})

test('auth', async function (t) {
  t.plan(5)

  const hosting = new Hosting({ auth: '4321' })
  hosting.add('a.leet.ar', { destination: 'http://127.0.0.1:1337' })
  await hosting.listen({ insecurePort: 8080, securePort: false })

  const app = await createServer(1337, function (req, res) {
    t.is(req.headers['x-simple-hosting'], undefined)
    res.end('Hello')
  })

  try {
    await fetch('http://127.0.0.1:8080', { headers: { host: 'a.leet.ar' } })
    t.fail('Should have failed')
  } catch (err) {
    t.is(err.code, 'ECONNRESET')
  }

  try {
    await fetch('http://127.0.0.1:8080', { headers: { host: 'a.leet.ar', 'x-simple-hosting': '0000' } })
    t.fail('Should have failed')
  } catch (err) {
    t.is(err.code, 'ECONNRESET')
  }

  const a = await fetch('http://127.0.0.1:8080', { headers: { host: 'a.leet.ar', 'x-simple-hosting': '4321' } })
  t.is(a.status, 200)
  t.is(await a.text(), 'Hello')

  app.close()

  await hosting.close()
})

async function createServer (port, onrequest) {
  const server = http.createServer(onrequest)
  await listen(server, port)
  return server
}

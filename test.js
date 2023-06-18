const test = require('brittle')
const fetch = require('like-fetch')
const Hosting = require('./index.js')

test('basic', async function (t) {
  const hosting = new Hosting({ log: true })

  hosting.add('a.leet.ar', { destination: 'http://127.0.0.1:1337' })
  hosting.add('b.leet.ar', { destination: 'http://127.0.0.1:1338' })

  hosting.listen()

  const response = await fetch('http://127.0.0.1:80', {
    headers: {
      host: 'a.leet.ar'
    },
    timeout: 2000
  })
  console.log('status', response.status)
  const data = await response.text()
  console.log('data', data)

  await hosting.close()
})

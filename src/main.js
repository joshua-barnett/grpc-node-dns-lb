const process = require('process')

const { Client } = require('./client.js')
const { Server } = require('./server.js')

const [command] = process.argv.slice(-1)

const Command = {
  CLIENT: 'client',
  SERVER: 'server'
}

const path = '/com.demo.v1.LbDemoService/Exec'
const serialize = value => Buffer.from(JSON.stringify(value), 'utf8')
const deserialze = buffer =>
  Buffer.isBuffer(buffer) ? JSON.parse(buffer.toString()) : null

const main = () => {
  switch (command) {
    case Command.CLIENT:
      const client = new Client(path, serialize, deserialze)
      return client.run()
    case Command.SERVER:
      const server = new Server(path, serialize, deserialze)
      return server.run()
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  main
}

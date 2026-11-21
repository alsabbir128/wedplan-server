import { MongoClient } from 'mongodb'

let clientPromise

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI must be configured')

  if (!clientPromise) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
    clientPromise = client.connect().catch((error) => {
      clientPromise = undefined
      throw error
    })
  }

  const client = await clientPromise
  const databaseName = process.env.MONGODB_DB
  return databaseName ? client.db(databaseName) : client.db()
}

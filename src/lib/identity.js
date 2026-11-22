import { ObjectId } from 'mongodb'

export function userIdFilter(id) {
  const value = String(id)
  const databaseId = ObjectId.isValid(value) ? new ObjectId(value) : value
  return { $or: [{ _id: databaseId }, { id: value }] }
}

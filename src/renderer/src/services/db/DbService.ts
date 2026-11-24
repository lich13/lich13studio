import { DexieMessageDataSource } from './DexieMessageDataSource'

export class DbService extends DexieMessageDataSource {
  private static instance: DbService

  static getInstance(): DbService {
    if (!DbService.instance) {
      DbService.instance = new DbService()
    }
    return DbService.instance
  }
}

export const dbService = DbService.getInstance()

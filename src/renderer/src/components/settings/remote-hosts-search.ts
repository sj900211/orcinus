import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getRemoteHostsPaneSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.sftp.search.title', 'SFTP Hosts'),
    description: translate(
      'auto.components.settings.sftp.search.description',
      'Manage SFTP file-transfer hosts.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.sftp.search.sftp', 'sftp'),
      ...translateSearchKeyword('auto.components.settings.sftp.search.file', 'file'),
      ...translateSearchKeyword('auto.components.settings.sftp.search.transfer', 'transfer'),
      ...translateSearchKeyword('auto.components.settings.sftp.search.remote', 'remote'),
      ...translateSearchKeyword('auto.components.settings.sftp.search.host', 'host'),
      ...translateSearchKeyword('auto.components.settings.sftp.search.server', 'server')
    ]
  },
  {
    title: translate('auto.components.settings.sftp.search.addTitle', 'Add SFTP Host'),
    description: translate(
      'auto.components.settings.sftp.search.addDescription',
      'Add a new SFTP host.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.sftp.search.sftp', 'sftp'),
      ...translateSearchKeyword('auto.components.settings.sftp.search.add', 'add'),
      ...translateSearchKeyword('auto.components.settings.sftp.search.download', 'download'),
      ...translateSearchKeyword('auto.components.settings.sftp.search.upload', 'upload'),
      ...translateSearchKeyword('auto.components.settings.sftp.search.password', 'password')
    ]
  }
])

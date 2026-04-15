import { DeleteIcon } from '@renderer/components/Icons'
import type { RootState } from '@renderer/store'
import type { NotesTreeNode } from '@renderer/types/note'
import { exportNote } from '@renderer/utils/export'
import type { MenuProps } from 'antd'
import type { ItemType, MenuItemType } from 'antd/es/menu/interface'
import { Edit3, FilePlus, Folder, FolderOpen, Sparkles, Star, StarOff, UploadIcon } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

interface UseNotesMenuProps {
  renamingNodeIds: Set<string>
  onCreateNote: (name: string, targetFolderId?: string) => void
  onCreateFolder: (name: string, targetFolderId?: string) => void
  onRenameNode: (nodeId: string, newName: string) => void
  onToggleStar: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
  onSelectNode: (node: NotesTreeNode) => void
  handleStartEdit: (node: NotesTreeNode) => void
  handleAutoRename: (node: NotesTreeNode) => void
  activeNode?: NotesTreeNode | null
}

export const useNotesMenu = ({
  renamingNodeIds,
  onCreateNote,
  onCreateFolder,
  onToggleStar,
  onDeleteNode,
  onSelectNode,
  handleStartEdit,
  handleAutoRename,
  activeNode
}: UseNotesMenuProps) => {
  const { t } = useTranslation()
  const exportMenuOptions = useSelector((state: RootState) => state.settings.exportMenuOptions)

  const handleDeleteNodeWrapper = useCallback(
    (node: NotesTreeNode) => {
      const confirmText =
        node.type === 'folder'
          ? t('notes.delete_folder_confirm', { name: node.name })
          : t('notes.delete_note_confirm', { name: node.name })

      window.modal.confirm({
        title: t('notes.delete'),
        content: confirmText,
        centered: true,
        okButtonProps: { danger: true },
        onOk: () => {
          onDeleteNode(node.id)
        }
      })
    },
    [onDeleteNode, t]
  )

  const getMenuItems = useCallback(
    (node: NotesTreeNode) => {
      const baseMenuItems: MenuProps['items'] = []

      // only show auto rename for file for now
      if (node.type !== 'folder') {
        baseMenuItems.push({
          label: t('notes.auto_rename.label'),
          key: 'auto-rename',
          icon: <Sparkles size={14} />,
          disabled: renamingNodeIds.has(node.id),
          onClick: () => {
            handleAutoRename(node)
          }
        })
      }

      if (node.type === 'folder') {
        baseMenuItems.push(
          {
            label: t('notes.new_note'),
            key: 'new_note',
            icon: <FilePlus size={14} />,
            onClick: () => {
              onCreateNote(t('notes.untitled_note'), node.id)
            }
          },
          {
            label: t('notes.new_folder'),
            key: 'new_folder',
            icon: <Folder size={14} />,
            onClick: () => {
              onCreateFolder(t('notes.untitled_folder'), node.id)
            }
          },
          { type: 'divider' }
        )
      }

      baseMenuItems.push(
        {
          label: t('notes.rename'),
          key: 'rename',
          icon: <Edit3 size={14} />,
          onClick: () => {
            handleStartEdit(node)
          }
        },
        {
          label: t('notes.open_outside'),
          key: 'open_outside',
          icon: <FolderOpen size={14} />,
          onClick: () => {
            void window.api.openPath(node.externalPath)
          }
        }
      )
      if (node.type !== 'folder') {
        baseMenuItems.push(
          {
            label: node.isStarred ? t('notes.unstar') : t('notes.star'),
            key: 'star',
            icon: node.isStarred ? <StarOff size={14} /> : <Star size={14} />,
            onClick: () => {
              onToggleStar(node.id)
            }
          },
          {
            label: t('chat.topics.export.title'),
            key: 'export',
            icon: <UploadIcon size={14} />,
            children: [
              exportMenuOptions.markdown && {
                label: t('chat.topics.export.md.label'),
                key: 'markdown',
                onClick: () => exportNote({ node, platform: 'markdown' })
              },
              exportMenuOptions.docx && {
                label: t('chat.topics.export.word'),
                key: 'word',
                onClick: () => exportNote({ node, platform: 'docx' })
              },
              exportMenuOptions.obsidian && {
                label: t('chat.topics.export.obsidian'),
                key: 'obsidian',
                onClick: () => exportNote({ node, platform: 'obsidian' })
              }
            ].filter(Boolean) as ItemType<MenuItemType>[]
          }
        )
      }
      baseMenuItems.push(
        { type: 'divider' },
        {
          label: t('notes.delete'),
          danger: true,
          key: 'delete',
          icon: <DeleteIcon size={14} className="lucide-custom" />,
          onClick: () => {
            handleDeleteNodeWrapper(node)
          }
        }
      )

      return baseMenuItems
    },
    [
      t,
      handleStartEdit,
      onToggleStar,
      handleDeleteNodeWrapper,
      renamingNodeIds,
      handleAutoRename,
      exportMenuOptions,
      onCreateNote,
      onCreateFolder
    ]
  )

  return { getMenuItems }
}

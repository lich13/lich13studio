import { EditIcon } from '@renderer/components/Icons'
import { maskApiKey } from '@renderer/utils/api'
import type { InputRef } from 'antd'
import { Button, Flex, Input, List, Popconfirm, Tooltip, Typography } from 'antd'
import { Check, Minus, X } from 'lucide-react'
import type { FC } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import type { ApiKeyValidity } from './types'

export interface ApiKeyItemProps {
  apiKey: string
  onUpdate: (newKey: string) => ApiKeyValidity
  onRemove: () => void
  disabled?: boolean
  isNew?: boolean
}

/**
 * API Key 项组件
 * 支持编辑、删除等操作
 */
const ApiKeyItem: FC<ApiKeyItemProps> = ({ apiKey, onUpdate, onRemove, disabled = false, isNew = false }) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(isNew || !apiKey.trim())
  const [editValue, setEditValue] = useState(apiKey)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const inputRef = useRef<InputRef>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  useEffect(() => {
    setHasUnsavedChanges(editValue.trim() !== apiKey.trim())
  }, [editValue, apiKey])

  const handleEdit = () => {
    if (disabled) return
    setIsEditing(true)
    setEditValue(apiKey)
  }

  const handleSave = () => {
    const result = onUpdate(editValue)
    if (!result.isValid) {
      window.toast.warning(result.error)
      return
    }

    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    if (isNew || !apiKey.trim()) {
      // 临时项取消时直接移除
      onRemove()
    } else {
      // 现有项取消时恢复原值
      setEditValue(apiKey)
      setIsEditing(false)
    }
  }

  return (
    <List.Item>
      {isEditing ? (
        <ItemInnerContainer style={{ gap: '10px' }}>
          <Input.Password
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onPressEnter={handleSave}
            placeholder={t('settings.provider.api.key.new_key.placeholder')}
            style={{ flex: 1, fontSize: '14px', marginLeft: '-10px' }}
            spellCheck={false}
            disabled={disabled}
          />
          <Flex gap={0} align="center">
            <Tooltip title={t('common.save')}>
              <Button
                type={hasUnsavedChanges ? 'primary' : 'text'}
                icon={<Check size={16} />}
                onClick={handleSave}
                disabled={disabled}
              />
            </Tooltip>
            <Tooltip title={t('common.cancel')}>
              <Button type="text" icon={<X size={16} />} onClick={handleCancelEdit} disabled={disabled} />
            </Tooltip>
          </Flex>
        </ItemInnerContainer>
      ) : (
        <ItemInnerContainer style={{ gap: '10px' }}>
          <Tooltip
            title={
              <Typography.Text style={{ color: 'white' }} copyable={{ text: apiKey }}>
                {apiKey}
              </Typography.Text>
            }
            mouseEnterDelay={0.5}
            placement="top"
            // 确保不留下明文
            destroyOnHidden>
            <span style={{ cursor: 'help' }}>{maskApiKey(apiKey)}</span>
          </Tooltip>

          <Flex gap={10} align="center">
            <Flex gap={0} align="center">
              <Tooltip title={t('common.edit')} mouseLeaveDelay={0}>
                <Button type="text" icon={<EditIcon size={16} />} onClick={handleEdit} disabled={disabled} />
              </Tooltip>
              <Popconfirm
                title={t('common.delete_confirm')}
                onConfirm={onRemove}
                disabled={disabled}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                okButtonProps={{ danger: true }}>
                <Tooltip title={t('common.delete')} mouseLeaveDelay={0}>
                  <Button type="text" icon={<Minus size={16} />} disabled={disabled} />
                </Tooltip>
              </Popconfirm>
            </Flex>
          </Flex>
        </ItemInnerContainer>
      )}
    </List.Item>
  )
}

const ItemInnerContainer = styled(Flex)`
  flex: 1;
  justify-content: space-between;
  align-items: center;
`

export default memo(ApiKeyItem)

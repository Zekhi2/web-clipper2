import { Form } from '@ant-design/compatible';
import '@ant-design/compatible/assets/index.less';
import { FormComponentProps } from '@ant-design/compatible/lib/form';
import { Input, Select } from 'antd';
import React, { Component, Fragment } from 'react';
import { ObsidianFormConfig } from './interface';
import { FilenameSanitizeMode } from './sanitizeFilename';

interface OneNoteProps {
  info?: ObsidianFormConfig;
}

export default class extends Component<OneNoteProps & FormComponentProps> {
  render() {
    const {
      form: { getFieldDecorator },
      info,
    } = this.props;
    let initData: Partial<ObsidianFormConfig> = {};
    if (info) {
      initData = info;
    }
    return (
      <Fragment>
        <Form.Item label="Vault">
          {getFieldDecorator('vault', {
            initialValue: initData.vault,
            rules: [
              {
                required: true,
                message: 'Please input your vault!',
              },
            ],
          })(<Input />)}
        </Form.Item>
        <Form.Item label="Save Folder">
          {getFieldDecorator('folder', {
            initialValue: initData.folder,
            rules: [
              {
                required: true,
                message: 'Please input the folders you want to save!',
              },
            ],
          })(<Input.TextArea placeholder='Please enter the folders you want to save, one per line.' />)}
        </Form.Item>
        <Form.Item
          label="Filename Characters"
          extra={'How to handle characters that Windows and Obsidian forbid in file names (\\ / : * ? " < > | [ ] # ^).'}
        >
          {getFieldDecorator('sanitize', {
            initialValue: initData.sanitize || 'fullwidth',
          })(
            <Select>
              <Select.Option value="fullwidth">Fullwidth symbols: a:b → a：b</Select.Option>
              <Select.Option value="underscore">Underscore: a:b → a_b</Select.Option>
              <Select.Option value="off">Off (raw title, may fail on Windows)</Select.Option>
            </Select>
          )}
        </Form.Item>
      </Fragment>
    );
  }
}

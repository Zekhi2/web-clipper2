import React, { Fragment } from 'react';
import { Form } from '@ant-design/compatible';
import '@ant-design/compatible/assets/index.less';
import { Input } from 'antd';
import { FormComponentProps } from '@ant-design/compatible/lib/form';
import { FormattedMessage } from 'react-intl';
import localeService from '@/common/locales';

interface NotionFormProps {
  verified?: boolean;
  info?: any;
}

const TOKEN_PATTERN = /^(ntn_|secret_)/;

const NotionForm: React.FC<NotionFormProps & FormComponentProps> = ({
  form: { getFieldDecorator },
  info,
  verified,
}) => {
  const initData: Record<string, string> = info || {};
  const disabled = !!info || !!verified;

  return (
    <Fragment>
      <Form.Item
        label={localeService.format({
          id: 'backend.services.notion.form.pat.label',
          defaultMessage: 'Personal Access Token',
        })}
        extra={
          <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.6, color: '#8c8c8c' }}>
            <FormattedMessage
              id="backend.services.notion.form.pat.help"
              defaultMessage="Create an internal integration in Notion and paste its ntn_ token here."
            />{' '}
            <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer">
              <FormattedMessage
                id="backend.services.notion.form.pat.manage"
                defaultMessage="Create token →"
              />
            </a>
          </div>
        }
      >
        {getFieldDecorator('personalAccessToken', {
          initialValue: initData.personalAccessToken,
          rules: [
            {
              required: true,
              message: localeService.format({
                id: 'backend.services.notion.form.pat.required',
                defaultMessage: 'Personal Access Token is required.',
              }),
            },
            {
              pattern: TOKEN_PATTERN,
              message: localeService.format({
                id: 'backend.services.notion.form.pat.pattern',
                defaultMessage: 'Token must start with ntn_ or secret_.',
              }),
            },
          ],
        })(<Input.Password autoComplete="off" disabled={disabled} placeholder="ntn_xxxxxxxxxx" />)}
      </Form.Item>

      <div
        style={{
          marginTop: 8,
          padding: '10px 12px',
          background: '#fffbe6',
          border: '1px solid #ffe58f',
          borderRadius: 4,
          fontSize: 12,
          lineHeight: 1.7,
          color: '#ad6800',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 6, color: '#d48806' }}>
          <FormattedMessage
            id="backend.services.notion.form.share.title"
            defaultMessage="Share the target page with your integration before verifying"
          />
        </div>
        <div>
          <FormattedMessage
            id="backend.services.notion.form.share.step1"
            defaultMessage="1. Open the page/database you want to clip into in Notion."
          />
        </div>
        <div>
          <FormattedMessage
            id="backend.services.notion.form.share.step2"
            defaultMessage="2. Click ... (top right) → Add connections → select your integration."
          />
        </div>
        <div>
          <FormattedMessage
            id="backend.services.notion.form.share.step3"
            defaultMessage="3. Confirm, then click Verify below. Otherwise the repository list stays empty."
          />
        </div>
      </div>
    </Fragment>
  );
};

export default NotionForm;

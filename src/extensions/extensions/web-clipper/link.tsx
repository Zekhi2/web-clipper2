import { ToolExtension } from '@/extensions/common';
import localeService from '@/common/locales';
import { CATEGORY_BOOKMARK, isBookmarkStub } from '@/common/clipCategory';
import {
  countChars,
  countEnglishWords,
  countHanzi,
  countParagraphs,
  countWords,
  extractTemplateVariablesAsync,
  getDate,
  getTime,
} from './templateVariables';

export default class Link extends ToolExtension<any> {
  constructor() {
    super(
      {
        extensionId: 'link',
        name: 'Link',
        icon: 'link',
        version: '0.0.3',
        automatic: true,
        description: 'Add link at the end of the document.',
        config: {
          scheme: {
            type: 'object',
            properties: {
              template: {
                type: 'string',
                title: localeService.format({
                  id: 'extension.link.config.template',
                }),
                'x-decorator': 'FormItem',
                'x-component': 'textarea',
                'x-component-props': { autoSize: true },
              },
              autoRunExclude: {
                type: 'array',
                title: localeService.format({
                  id: 'extension.link.config.autoRunExclude',
                }),
                'x-decorator': 'FormItem',
                'x-component': 'clipExtensionsSelect',
              },
            },
          },
          default: {
            template: '[{TITLE}]({URL}) \n\n {DOCUMENT}',
            autoRunExclude: [],
          },
        },
				i18nManifest: {
					'de-DE': { name: 'Link', description: 'Fügen Sie am Ende des Dokuments einen Link hinzu.' },
					'en-US': { name: 'Link', description: 'Add link at the end of the document.' },
					'ja-JP': { name: 'リンク', description: 'ドキュメントの最後にリンクを追加します。' },
					'ko-KR': { name: '링크', description: '문서 끝에 링크를 추가합니다.' },
					'ru-RU': { name: 'Ссылка', description: 'Добавить ссылку в конце документа.' },
					'zh-CN': { name: '添加模版', description: '根据插件设置中的模板，添加内容，默认添加页面链接' },
				}
			},
      {
        run: async context => {
          return extractTemplateVariablesAsync(context.document);
        },
        afterRun: async context => {
          const config: { template: string } = context.config!;
          return localeService.format(
            { id: 'plugin.link', defaultMessage: config.template },
            {
              ...context.result,
              DATE: getDate(),
              TIME: getTime(),
              WORDS: `${countWords(context.data)}`,
              HANZI: `${countHanzi(context.data)}`,
              ENGLISH_WORDS: `${countEnglishWords(context.data)}`,
              PARAGRAPHS: `${countParagraphs(context.data)}`,
              CHARS: `${countChars(context.data)}`,
              DOCUMENT: context.data,
              // Bookmark clips wrap a tiny link stub instead of an article,
              // which the DOM-based detection cannot see at run() time.
              CATEGORY: isBookmarkStub(context.data)
                ? CATEGORY_BOOKMARK
                : context.result.CATEGORY,
            }
          );
        },
      }
    );
  }
}

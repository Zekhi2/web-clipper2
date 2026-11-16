import { IExtensionWithId, ToolExtension, TextExtension } from './common';
import { IContextMenuExtensionFactory } from './contextMenus';

const context = require.context('./extensions', true, /(?<!\.test)\.(ts|tsx)$/);

const contextMenusContext = require.context('./contextMenus', true, /(?<!\.test)\.(ts|tsx)$/);

export const contextMenus = contextMenusContext.keys().map(key => {
  const ContextMenuExtensionFactory: IContextMenuExtensionFactory = contextMenusContext(key)
    .default;
  return {
    id: ContextMenuExtensionFactory.id,
    contextMenu: ContextMenuExtensionFactory,
  };
});

// Only modules with a default export are extensions. Helper modules living in
// these directories (without a default export) must not be registered, or the
// extension container initialization will crash on their missing manifest.
export const extensions: IExtensionWithId[] = context.keys()
  .filter(key => !!context(key).default)
  .map(key => {
  const id = key.slice(2, key.length - 3);
  const extension = context(key).default;
  if (extension instanceof ToolExtension || extension instanceof TextExtension) {
    return {
      ...context(key).default,
      id,
      router: `/plugins/${id}`,
    };
  }
  return {
    factory: extension,
    id,
    router: `/plugins/${id}`,
  };
});

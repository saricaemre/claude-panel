const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('panel', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  info: () => ipcRenderer.invoke('app:info'),
  pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', defaultPath),
  rebuildMenu: () => ipcRenderer.send('menu:rebuild'),

  ptyCreate: (opts) => ipcRenderer.invoke('pty:create', opts),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_e, id, data) => cb(id, data)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_e, id, code) => cb(id, code)),

  chatStart: (opts) => ipcRenderer.invoke('chat:start', opts),
  chatSend: (id, text, images) => ipcRenderer.send('chat:send', id, text, images),
  chatPermissionReply: (id, rid, reply) => ipcRenderer.send('chat:permissionReply', id, rid, reply),
  chatInterrupt: (id) => ipcRenderer.invoke('chat:interrupt', id),
  chatSetModel: (id, model) => ipcRenderer.invoke('chat:setModel', id, model),
  chatSetMode: (id, mode) => ipcRenderer.invoke('chat:setMode', id, mode),
  chatSetEffort: (id, level) => ipcRenderer.invoke('chat:setEffort', id, level),
  chatClose: (id) => ipcRenderer.send('chat:close', id),
  chatSessions: (accountId, cwd) => ipcRenderer.invoke('chat:sessions', accountId, cwd),
  chatHistory: (accountId, sessionId, cwd) => ipcRenderer.invoke('chat:history', accountId, sessionId, cwd),
  onChatMsg: (cb) => ipcRenderer.on('chat:msg', (_e, id, msg) => cb(id, msg)),
  onChatEnd: (cb) => ipcRenderer.on('chat:end', (_e, id, err) => cb(id, err)),
  onChatPermission: (cb) => ipcRenderer.on('chat:permission', (_e, id, req) => cb(id, req)),
  onChatPermissionDone: (cb) => ipcRenderer.on('chat:permissionDone', (_e, id, rid) => cb(id, rid)),
  onChatModels: (cb) => ipcRenderer.on('chat:models', (_e, id, models) => cb(id, models)),

  onMenu: (cb) => ipcRenderer.on('menu:cmd', (_e, cmd, arg) => cb(cmd, arg)),
  openExternal: (url) => ipcRenderer.send('open:external', url),
  openFolder: (dir) => ipcRenderer.send('open:folder', dir),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
});

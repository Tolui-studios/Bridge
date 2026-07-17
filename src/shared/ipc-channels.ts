export const IPC = {
  GamesList: 'bridge:games:list',
  GamesAdd: 'bridge:games:add',
  GamesUpdate: 'bridge:games:update',
  GamesRemove: 'bridge:games:remove',
  GoalsGet: 'bridge:goals:get',
  GoalsCreateTemplate: 'bridge:goals:create-template',
  DialogPickFolder: 'bridge:dialog:pick-folder',
  EvGoalsChanged: 'bridge:event:goals-changed',
  EvRegistryChanged: 'bridge:event:registry-changed'
} as const

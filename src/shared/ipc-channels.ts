export const IPC = {
  GamesList: 'bridge:games:list',
  GamesAdd: 'bridge:games:add',
  GamesUpdate: 'bridge:games:update',
  GamesRemove: 'bridge:games:remove',
  GoalsGet: 'bridge:goals:get',
  GoalsCreateTemplate: 'bridge:goals:create-template',
  GoalsMutate: 'bridge:goals:mutate',
  ShellOpenRepo: 'bridge:shell:open-repo',
  DialogPickFolder: 'bridge:dialog:pick-folder',
  AgentsStart: 'bridge:agents:start',
  AgentsCancel: 'bridge:agents:cancel',
  AgentsList: 'bridge:agents:list',
  AgentsTranscript: 'bridge:agents:transcript',
  EvGoalsChanged: 'bridge:event:goals-changed',
  EvRegistryChanged: 'bridge:event:registry-changed',
  EvAgentEvent: 'bridge:event:agent-event'
} as const

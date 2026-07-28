/**
 * IPC channel names, grouped by domain. Each block is its own `as const`
 * object spread into IPC, so parallel branches adding channels to different
 * domains never touch the same lines. Add new channels to the matching block
 * (events live with their owning domain) — never at the end of the file.
 */

const GAMES = {
  GamesList: 'bridge:games:list',
  GamesAdd: 'bridge:games:add',
  GamesCreate: 'bridge:games:create',
  GamesUpdate: 'bridge:games:update',
  GamesRemove: 'bridge:games:remove',
  GamesDelete: 'bridge:games:delete',
  EvGameCreateProgress: 'bridge:event:game-create-progress',
  EvRegistryChanged: 'bridge:event:registry-changed'
} as const

const GOALS = {
  GoalsGet: 'bridge:goals:get',
  GoalsCreateTemplate: 'bridge:goals:create-template',
  GoalsMutate: 'bridge:goals:mutate',
  EvGoalsChanged: 'bridge:event:goals-changed'
} as const

const SHELL = {
  ShellOpenRepo: 'bridge:shell:open-repo',
  DialogPickFolder: 'bridge:dialog:pick-folder'
} as const

const AGENTS = {
  AgentsStart: 'bridge:agents:start',
  AgentsCancel: 'bridge:agents:cancel',
  AgentsReprompt: 'bridge:agents:reprompt',
  AgentsInterrupt: 'bridge:agents:interrupt',
  AgentsSetMode: 'bridge:agents:set-mode',
  AgentsSetModel: 'bridge:agents:set-model',
  AgentsClearTests: 'bridge:agents:clear-tests',
  AgentsAnswer: 'bridge:agents:answer',
  AgentsResume: 'bridge:agents:resume',
  AgentsList: 'bridge:agents:list',
  AgentsTranscript: 'bridge:agents:transcript',
  EvAgentEvent: 'bridge:event:agent-event'
} as const

const USAGE = {
  UsageGet: 'bridge:usage:get',
  EvUsageChanged: 'bridge:event:usage-changed'
} as const

const SETTINGS = {
  SettingsGet: 'bridge:settings:get',
  SettingsSetVault: 'bridge:settings:set-vault',
  SettingsSetGamesRoot: 'bridge:settings:set-games-root',
  SettingsOpenGamesRoot: 'bridge:settings:open-games-root',
  EvSettingsChanged: 'bridge:event:settings-changed'
} as const

const VAULT = {
  VaultNotes: 'bridge:vault:notes',
  VaultOpen: 'bridge:vault:open',
  VaultLogDecision: 'bridge:vault:log-decision'
} as const

const TEAM = {
  TeamConnect: 'bridge:team:connect',
  TeamDisconnect: 'bridge:team:disconnect',
  TeamState: 'bridge:team:state',
  TeamFocus: 'bridge:team:focus',
  TeamNoteGet: 'bridge:team:note-get',
  TeamNoteSave: 'bridge:team:note-save',
  TeamLinkGame: 'bridge:team:link-game',
  EvTeamChanged: 'bridge:event:team-changed',
  EvTeamNote: 'bridge:event:team-note'
} as const

const GIT = {
  GitStatus: 'bridge:git:status',
  GameTooling: 'bridge:git:tooling',
  GitPull: 'bridge:git:pull',
  GitWorktrees: 'bridge:git:worktrees',
  GitWorktreeChanges: 'bridge:git:worktree-changes',
  GitWorktreeRemove: 'bridge:git:worktree-remove',
  GitWorktreeOpenEditor: 'bridge:git:worktree-open-editor',
  GitCreatePr: 'bridge:git:create-pr',
  GitMoveToOrg: 'bridge:git:move-to-org'
} as const

const ROJO = {
  RojoOpenBuild: 'bridge:rojo:open-build',
  RojoStop: 'bridge:rojo:stop',
  RojoStatus: 'bridge:rojo:status',
  EvRojoChanged: 'bridge:event:rojo-changed'
} as const

const UPDATE = {
  UpdateGet: 'bridge:update:get',
  UpdateInstall: 'bridge:update:install',
  EvUpdateChanged: 'bridge:event:update-changed'
} as const

export const IPC = {
  ...GAMES,
  ...GOALS,
  ...SHELL,
  ...AGENTS,
  ...USAGE,
  ...SETTINGS,
  ...VAULT,
  ...TEAM,
  ...GIT,
  ...ROJO,
  ...UPDATE
} as const

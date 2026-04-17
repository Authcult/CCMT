export type PublishTarget = {
  id: string;
  label: string;
  command: string;
};

export function getPublishTargets(defaultTargetId: string): PublishTarget[] {
  return [
    {
      id: defaultTargetId,
      label: "Claude Main Session",
      command: process.env.CCMT_SHELL ?? "/bin/bash",
    },
  ];
}

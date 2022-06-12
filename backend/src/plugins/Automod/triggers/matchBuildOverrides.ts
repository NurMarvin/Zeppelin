import * as t from "io-ts";

import { BuildOverride, getBuildOverridesInString, resolveBuildOverride, tNullable } from "../../../utils";
import { getTextMatchPartialSummary } from "../functions/getTextMatchPartialSummary";
import { MatchableTextType, matchMultipleTextTypesOnMessage } from "../functions/matchMultipleTextTypesOnMessage";
import { automodTrigger } from "../helpers";

interface MatchResultType {
  type: MatchableTextType;
  signature: string;
  buildOverride?: BuildOverride;
}

export const MatchBuildOverridesTrigger = automodTrigger<MatchResultType>()({
  configType: t.type({
    include_branches: tNullable(t.array(t.string)),
    exclude_branches: tNullable(t.array(t.string)),
    include_signatures: tNullable(t.array(t.string)),
    exclude_signatures: tNullable(t.array(t.string)),
    match_messages: t.boolean,
    match_embeds: t.boolean,
    match_visible_names: t.boolean,
    match_usernames: t.boolean,
    match_nicknames: t.boolean,
    match_custom_status: t.boolean,
  }),
  defaultConfig: {
    match_messages: true,
    match_embeds: false,
    match_visible_names: false,
    match_usernames: false,
    match_nicknames: false,
    match_custom_status: false,
  },
  match: async ({ pluginData, context, triggerConfig: trigger }) => {
    if (!context.message) {
      return;
    }

    for await (const [type, str] of matchMultipleTextTypesOnMessage(pluginData, trigger, context.message)) {
      const buildOverrides = getBuildOverridesInString(str);
      if (buildOverrides.length === 0) continue;

      const uniqueBuildOverrides = Array.from(new Set(buildOverrides));

      for (const signature of uniqueBuildOverrides) {
        if (trigger.include_signatures && trigger.include_signatures.includes(signature)) {
          return { extra: { type, signature } };
        }

        if (trigger.exclude_signatures && !trigger.exclude_signatures.includes(signature)) {
          return { extra: { type, signature } };
        }
      }

      for (const signature of uniqueBuildOverrides) {
        const buildOverride = await resolveBuildOverride(signature);
        if (!buildOverride) return { extra: { type, signature } };

        const projects = Object.keys(buildOverride.targetBuildOverride);

        for (const project of projects) {
          const projectOverride = buildOverride.targetBuildOverride[project];

          // Check if the project is in the include list
          if (
            trigger.include_branches &&
            projectOverride.type === "branch" &&
            trigger.include_branches.includes(projectOverride.id)
          ) {
            return { extra: { type, signature, buildOverride } };
          }

          // Check if the project is in the exclude list
          if (
            trigger.exclude_branches &&
            projectOverride.type === "branch" &&
            !trigger.exclude_branches.includes(projectOverride.id)
          ) {
            return { extra: { type, signature, buildOverride } };
          }
        }
      }
    }

    return null;
  },
  renderMatchInformation: ({ pluginData, contexts, matchResult }) => {
    let matchedText: string;

    if (matchResult.extra.buildOverride) {
      const buildOverride = matchResult.extra.buildOverride as BuildOverride;
      const projects = Object.keys(buildOverride.targetBuildOverride);
      const projectOverrides = projects.map((project) => buildOverride.targetBuildOverride[project]);

      matchedText = `build override for projects \`${projects.join(", ")}\` (${projectOverrides
        .map((projectOverride) =>
          projectOverride.type === "branch" ? `branch ${projectOverride.id}` : `id ${projectOverride.id}`,
        )
        .join(", ")})`;
    } else {
      matchedText = `build override \`${matchResult.extra.signature}\``;
    }

    const partialSummary = getTextMatchPartialSummary(pluginData, matchResult.extra.type, contexts[0]);
    return `Matched ${matchedText} in ${partialSummary}`;
  },
});

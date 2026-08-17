/**
 * Keep built-in tool rows compact while the agent works and after it settles.
 * Thinking uses Pi's collapsed-thinking label.
 *
 * Ctrl+O expands/collapses tools. Ctrl+T expands/collapses thinking.
 */

import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	SettingsManager,
	Theme,
	type ExtensionAPI,
	type ToolDefinition,
	type ToolsOptions,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

type AnyTool = ToolDefinition<any, any, any>;

const THINKING_LABEL = "· thinking";
const ITALIC_PATCH = Symbol.for("pi.auto-collapse.no-italic");

function disableItalicBackgroundArtifacts(): void {
	const prototype = Theme.prototype as Theme & Record<PropertyKey, unknown>;
	if (prototype[ITALIC_PATCH]) return;

	// Windows Terminal renders italic glyph cells over background images with
	// opaque black rectangles. Disable italic globally in Pi's shared Theme
	// prototype; this also fixes Markdown quotes, which Pi italicizes.
	prototype.italic = (text: string) => text;
	prototype[ITALIC_PATCH] = true;
}

function getToolOptions(cwd: string): ToolsOptions | undefined {
	try {
		const settings = SettingsManager.create(cwd);
		return {
			read: { autoResizeImages: settings.getImageAutoResize() },
			bash: {
				commandPrefix: settings.getShellCommandPrefix(),
				shellPath: settings.getShellPath(),
			},
		};
	} catch {
		return undefined;
	}
}

function getBuiltInTools(cwd: string): AnyTool[] {
	const options = getToolOptions(cwd);
	return [
		createReadToolDefinition(cwd, options?.read),
		createBashToolDefinition(cwd, options?.bash),
		createEditToolDefinition(cwd, options?.edit),
		createWriteToolDefinition(cwd, options?.write),
		createGrepToolDefinition(cwd, options?.grep),
		createFindToolDefinition(cwd, options?.find),
		createLsToolDefinition(cwd, options?.ls),
	] as AnyTool[];
}

function compactRenderer(base: AnyTool): AnyTool {
	const fullCall = base.renderCall;
	const fullResult = base.renderResult;

	return {
		...base,
		// Avoid Pi's padded/background tool box. The self-rendering shell keeps
		// only the single separator line enforced by ToolExecutionComponent.
		renderShell: "self",
		renderCall(args, theme, context) {
			if (context.expanded && fullCall) {
				return fullCall(args, theme, context);
			}
			// Match Pi's default assistant/thinking horizontal output padding.
			return new Text(theme.fg("dim", `· ${base.name}`), 1, 0);
		},
		renderResult(result, options, theme, context) {
			if (options.expanded && fullResult) {
				return fullResult(result, options, theme, context);
			}
			return new Text("", 0, 0);
		},
	};
}

export default function (pi: ExtensionAPI) {
	const registerCompactTools = (cwd: string) => {
		for (const tool of getBuiltInTools(cwd)) {
			pi.registerTool(compactRenderer(tool));
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		registerCompactTools(ctx.cwd);
		// Pi forcibly italicizes hidden thinking and Markdown quotes. Disable the
		// shared italic renderer to avoid opaque black cells in Windows Terminal.
		disableItalicBackgroundArtifacts();
		ctx.ui.setHiddenThinkingLabel(THINKING_LABEL);

		// A resumed idle transcript should start compact.
		if (ctx.mode === "tui" && ctx.isIdle()) {
			ctx.ui.setToolsExpanded(false);
		}
	});

	pi.registerCommand("auto-collapse", {
		description: "Show the status of compact tool and thinking rendering",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				"Compact transcript is active. Ctrl+O toggles tools; Ctrl+T toggles thinking.",
				"info",
			);
		},
	});
}

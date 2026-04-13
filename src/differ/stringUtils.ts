/** Method to insert a line in a string */
export function insertLine(args: {
	fullText: string;
	newLine: string;
	position: number;
}): string {
	const lines = args.fullText.split("\n");
	// Split newLine so embedded '\n' chars don't double up when joined.
	// Strip a trailing empty string — artifact of '\n'-terminated content that
	// was processed through updateState's .concat("\n").split("\n") normalization.
	const newLines = args.newLine.split("\n");
	if (newLines.length > 1 && newLines[newLines.length - 1] === "") {
		newLines.pop();
	}
	lines.splice(args.position, 0, ...newLines);
	return lines.join("\n");
}

/** Method to replace a line in a string */
export function replaceLine(args: {
	fullText: string;
	newLine: string;
	position: number;
	linesToReplace: number;
}): string {
	const lines = args.fullText.split("\n");
	if (args.newLine === "") {
		lines.splice(args.position, args.linesToReplace);
	} else {
		// Same split-and-strip logic as insertLine to avoid double '\n'.
		const newLines = args.newLine.split("\n");
		if (newLines.length > 1 && newLines[newLines.length - 1] === "") {
			newLines.pop();
		}
		lines.splice(args.position, args.linesToReplace, ...newLines);
	}
	return lines.join("\n");
}

/** Method to delete a line in a string */
export function deleteLines(args: {
	fullText: string;
	position: number;
	count: number;
}): string {
	const lines = args.fullText.split("\n");
	lines.splice(args.position, args.count);
	return lines.join("\n");
}

/** Returns an invisible character when the text is empty. */
export function preventEmptyString(text: string): string {
	return text !== "" ? text : "‎";
}

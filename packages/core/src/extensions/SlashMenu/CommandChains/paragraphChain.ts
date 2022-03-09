import { Range, Editor } from "@tiptap/core";

export default function paragraphChain() {
  return (editor: Editor, range: Range) => {
    editor.chain().focus().deleteRange(range).clearBlockAttributes().run();
    return true;
  };
}
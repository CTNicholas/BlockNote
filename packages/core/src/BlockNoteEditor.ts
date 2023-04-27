import { Editor, EditorOptions } from "@tiptap/core";
import { Node } from "prosemirror-model";
// import "./blocknote.css";
import { Editor as TiptapEditor } from "@tiptap/core/dist/packages/core/src/Editor";
import {
  insertBlocks,
  removeBlocks,
  replaceBlocks,
  updateBlock,
} from "./api/blockManipulation/blockManipulation";
import {
  blocksToHTML,
  blocksToMarkdown,
  HTMLToBlocks,
  markdownToBlocks,
} from "./api/formatConversions/formatConversions";
import { nodeToBlock } from "./api/nodeConversions/nodeConversions";
import { getNodeById } from "./api/util/nodeUtil";
import { getBlockNoteExtensions, UiFactories } from "./BlockNoteExtensions";
import styles from "./editor.module.css";
import {
  BlockIdentifier,
  BlockSchema,
  BlockTemplate,
  BlockSpec,
  BlockSpecWithNode,
  PartialBlockTemplate,
  PropSpec,
  PropSpecs,
  BlockSpecs,
  PropTypes,
  DefaultBlockProps,
} from "./extensions/Blocks/api/blockTypes";
import {
  MouseCursorPosition,
  TextCursorPosition,
} from "./extensions/Blocks/api/cursorPositionTypes";
import {
  DefaultBlocks,
  defaultBlocks,
  DefaultBlockSpecs,
  defaultBlockSpecs,
  DefaultBlockTypes,
  headingBlockSpec,
  HeadingBlockSpec,
  ParagraphBlockSpec,
} from "./extensions/Blocks/api/defaultBlocks";
import {
  ColorStyle,
  InlineContent,
  Styles,
  ToggledStyle,
} from "./extensions/Blocks/api/inlineContentTypes";
import { Selection } from "./extensions/Blocks/api/selectionTypes";
import { getBlockInfoFromPos } from "./extensions/Blocks/helpers/getBlockInfoFromPos";
import {
  BaseSlashMenuItem,
  defaultSlashMenuItems,
} from "./extensions/SlashMenu";
import {
  createBlockFromTiptapNode,
  createCustomBlock,
  imageBlock,
} from "./extensions/Blocks/api/block";

// Converts each block spec into a Block object without children
type BlocksWithoutChildren<Blocks extends BlockSpecs> = {
  [Block in keyof Blocks]: {
    id: string;
    type: Blocks[Block]["type"];
    props: PropTypes<Blocks[Block]["propSpecs"]>;
    content: InlineContent[];
  };
};

// Converts each block spec into a Block object without children, merges them
// into a union type, and adds a children property
type Block<Blocks extends BlockSpecs> =
  BlocksWithoutChildren<Blocks>[keyof BlocksWithoutChildren<Blocks>] & {
    children: Block<Blocks>[];
  };

type PartialBlocksWithoutChildren<Blocks extends BlockSpecs> = {
  [Block in keyof Blocks]: Partial<{
    id: string;
    type: Blocks[Block]["type"];
    props: Partial<PropTypes<Blocks[Block]["propSpecs"]>>;
    content: InlineContent[] | string;
  }>;
};

type PartialBlock<Blocks extends BlockSpecs> =
  PartialBlocksWithoutChildren<Blocks>[keyof PartialBlocksWithoutChildren<Blocks>] &
    Partial<{
      children: PartialBlock<Blocks>[];
    }>;

export type BlockNoteEditorOptions<
  Blocks extends BlockSpecs = DefaultBlockSpecs
> = {
  // TODO: Figure out if enableBlockNoteExtensions/disableHistoryExtension are needed and document them.
  enableBlockNoteExtensions: boolean;
  disableHistoryExtension: boolean;
  /**
   * Factories used to create a custom UI for BlockNote
   */
  uiFactories: UiFactories;
  /**
   * TODO: why is this called slashCommands and not slashMenuItems?
   *
   * @default defaultSlashMenuItems from `./extensions/SlashMenu`
   */
  slashCommands: BaseSlashMenuItem[];

  /**
   * The HTML element that should be used as the parent element for the editor.
   *
   * @default: undefined, the editor is not attached to the DOM
   */
  parentElement: HTMLElement;
  /**
   * An object containing attributes that should be added to the editor's HTML element.
   *
   * @example { class: "my-editor-class" }
   */
  editorDOMAttributes: Record<string, string>;
  /**
   *  A callback function that runs when the editor is ready to be used.
   */
  onEditorReady: (editor: BlockNoteEditor<Blocks>) => void;
  /**
   * A callback function that runs whenever the editor's contents change.
   */
  onEditorContentChange: (editor: BlockNoteEditor<Blocks>) => void;
  /**
   * A callback function that runs whenever the text cursor position changes.
   */
  onTextCursorPositionChange: (editor: BlockNoteEditor<Blocks>) => void;
  initialContent: PartialBlockTemplate<Blocks>[];

  /**
   * Use default BlockNote font and reset the styles of <p> <li> <h1> elements etc., that are used in BlockNote.
   *
   * @default true
   */
  defaultStyles: boolean;

  /**
   * A list of block types that should be available in the editor.
   */
  blockSpecs: Blocks; // TODO, type this so that it matches <Block>
  // tiptap options, undocumented
  _tiptapOptions: any;
};

const blockNoteTipTapOptions = {
  enableInputRules: true,
  enablePasteRules: true,
  enableCoreExtensions: false,
};

// TODO: make type of BareBlock / Block automatically based on options.blocks
export class BlockNoteEditor<Blocks extends BlockSpecs = DefaultBlockSpecs> {
  public readonly _tiptapEditor: TiptapEditor & { contentComponent: any };
  private blockCache = new WeakMap<Node, Block<Blocks>>();
  private mousePos = { x: 0, y: 0 };
  private readonly schema = new Map<
    string,
    BlockSpecWithNode<string, PropSpecs>
  >();

  public get domElement() {
    return this._tiptapEditor.view.dom as HTMLDivElement;
  }

  public focus() {
    this._tiptapEditor.view.focus();
  }

  constructor(options: Partial<BlockNoteEditorOptions<Blocks>> = {}) {
    console.log("test");
    // apply defaults
    options = {
      defaultStyles: true,
      blockSpecs:
        options.blockSpecs === undefined
          ? defaultBlockSpecs
          : options.blockSpecs,
      ...options,
    };

    const blockNoteExtensions = getBlockNoteExtensions<Blocks>({
      editor: this,
      uiFactories: options.uiFactories || {},
      slashCommands: options.slashCommands || defaultSlashMenuItems,
      blocks: [],
    });

    // add blocks to schema
    for (const block of options.blockSpecs || []) {
      this.schema.set(block.type, block);
    }

    let extensions = options.disableHistoryExtension
      ? blockNoteExtensions.filter((e) => e.name !== "history")
      : blockNoteExtensions;

    // for (const ext of extensions) {
    //   console.log(ext);
    //   if (ext.type === "node" && ext.config.group === "blockContent")
    // }

    const tiptapOptions: EditorOptions = {
      // TODO: This approach to setting initial content is "cleaner" but requires the PM editor schema, which is only
      //  created after initializing the TipTap editor. Not sure it's feasible.
      // content:
      //   options.initialContent &&
      //   options.initialContent.map((block) =>
      //     blockToNode(block, this._tiptapEditor.schema).toJSON()
      //   ),
      ...blockNoteTipTapOptions,
      ...options._tiptapOptions,
      onCreate: () => {
        options.onEditorReady?.(this);
        options.initialContent &&
          this.replaceBlocks(this.topLevelBlocks, options.initialContent);
        document.addEventListener(
          "mousemove",
          (event: MouseEvent) =>
            (this.mousePos = { x: event.clientX, y: event.clientY })
        );
      },
      onUpdate: () => {
        options.onEditorContentChange?.(this);
      },
      onSelectionUpdate: () => {
        options.onTextCursorPositionChange?.(this);
      },
      extensions:
        options.enableBlockNoteExtensions === false
          ? options._tiptapOptions?.extensions
          : [...(options._tiptapOptions?.extensions || []), ...extensions],
      editorProps: {
        attributes: {
          ...(options.editorDOMAttributes || {}),
          class: [
            styles.bnEditor,
            styles.bnRoot,
            options.defaultStyles ? styles.defaultStyles : "",
            options.editorDOMAttributes?.class || "",
          ].join(" "),
        },
      },
    };

    if (options.parentElement) {
      tiptapOptions.element = options.parentElement;
    }

    this._tiptapEditor = new Editor(tiptapOptions) as Editor & {
      contentComponent: any;
    };
  }

  /**
   * Gets a snapshot of all top-level (non-nested) blocks in the editor.
   * @returns A snapshot of all top-level (non-nested) blocks in the editor.
   */
  public get topLevelBlocks(): Block<Blocks>[] {
    const blocks: Block<Blocks>[] = [];

    this._tiptapEditor.state.doc.firstChild!.descendants((node) => {
      blocks.push(nodeToBlock(node, this.schema, this.blockCache));

      return false;
    });

    return blocks;
  }

  /**
   * Gets a snapshot of an existing block from the editor.
   * @param blockIdentifier The identifier of an existing block that should be retrieved.
   * @returns The block that matches the identifier, or `undefined` if no matching block was found.
   */
  public getBlock(blockIdentifier: BlockIdentifier): Block<Blocks> | undefined {
    const id =
      typeof blockIdentifier === "string"
        ? blockIdentifier
        : blockIdentifier.id;
    let newBlock: Block<Blocks> | undefined = undefined;

    this._tiptapEditor.state.doc.firstChild!.descendants((node) => {
      if (typeof newBlock !== "undefined") {
        return false;
      }

      if (node.type.name !== "blockContainer" || node.attrs.id !== id) {
        return true;
      }

      newBlock = nodeToBlock(node, this.schema, this.blockCache);

      return false;
    });

    return newBlock;
  }

  /**
   * Traverses all blocks in the editor depth-first, and executes a callback for each.
   * @param callback The callback to execute for each block. Returning `false` stops the traversal.
   * @param reverse Whether the blocks should be traversed in reverse order.
   */
  public forEachBlock(
    callback: (block: Block<Blocks>) => boolean,
    reverse: boolean = false
  ): void {
    const blocks = this.topLevelBlocks.slice();

    if (reverse) {
      blocks.reverse();
    }

    function traverseBlockArray(blockArray: Block<Blocks>[]): boolean {
      for (const block of blockArray) {
        if (!callback(block)) {
          return false;
        }

        const children = reverse
          ? block.children.slice().reverse()
          : block.children;

        if (!traverseBlockArray(children)) {
          return false;
        }
      }

      return true;
    }

    traverseBlockArray(blocks);
  }

  /**
   * Gets a snapshot of the current mouse cursor position.
   * @returns A snapshot of the current mouse cursor position.
   */
  public getMouseCursorPosition(): MouseCursorPosition | undefined {
    // Editor itself may have padding or other styling which affects size/position, so we get the boundingRect of
    // the first child (i.e. the blockGroup that wraps all blocks in the editor) for a more accurate bounding box.
    const editorBoundingBox = (
      this._tiptapEditor.view.dom.firstChild! as HTMLElement
    ).getBoundingClientRect();

    const pos = this._tiptapEditor.view.posAtCoords({
      left: editorBoundingBox.left + editorBoundingBox.width / 2,
      top: this.mousePos.y,
    });

    if (!pos) {
      return;
    }

    const blockInfo = getBlockInfoFromPos(
      this._tiptapEditor.state.doc,
      pos.pos
    );

    if (!blockInfo) {
      return;
    }

    return { block: nodeToBlock(blockInfo.node, this.schema, this.blockCache) };
  }

  /**
   * Gets a snapshot of the current text cursor position.
   * @returns A snapshot of the current text cursor position.
   */
  public getTextCursorPosition(): TextCursorPosition {
    const { node, depth, startPos, endPos } = getBlockInfoFromPos(
      this._tiptapEditor.state.doc,
      this._tiptapEditor.state.selection.from
    )!;

    // Index of the current blockContainer node relative to its parent blockGroup.
    const nodeIndex = this._tiptapEditor.state.doc
      .resolve(endPos)
      .index(depth - 1);
    // Number of the parent blockGroup's child blockContainer nodes.
    const numNodes = this._tiptapEditor.state.doc
      .resolve(endPos + 1)
      .node().childCount;

    // Gets previous blockContainer node at the same nesting level, if the current node isn't the first child.
    let prevNode: Node | undefined = undefined;
    if (nodeIndex > 0) {
      prevNode = this._tiptapEditor.state.doc.resolve(startPos - 2).node();
    }

    // Gets next blockContainer node at the same nesting level, if the current node isn't the last child.
    let nextNode: Node | undefined = undefined;
    if (nodeIndex < numNodes - 1) {
      nextNode = this._tiptapEditor.state.doc.resolve(endPos + 2).node();
    }

    return {
      block: nodeToBlock(node, this.schema, this.blockCache),
      prevBlock:
        prevNode === undefined
          ? undefined
          : nodeToBlock(prevNode, this.schema, this.blockCache),
      nextBlock:
        nextNode === undefined
          ? undefined
          : nodeToBlock(nextNode, this.schema, this.blockCache),
    };
  }

  /**
   * Sets the text cursor position to the start or end of an existing block. Throws an error if the target block could
   * not be found.
   * @param targetBlock The identifier of an existing block that the text cursor should be moved to.
   * @param placement Whether the text cursor should be placed at the start or end of the block.
   */
  public setTextCursorPosition(
    targetBlock: BlockIdentifier,
    placement: "start" | "end" = "start"
  ) {
    const id = typeof targetBlock === "string" ? targetBlock : targetBlock.id;

    const { posBeforeNode } = getNodeById(id, this._tiptapEditor.state.doc);
    const { startPos, contentNode } = getBlockInfoFromPos(
      this._tiptapEditor.state.doc,
      posBeforeNode + 2
    )!;

    if (placement === "start") {
      this._tiptapEditor.commands.setTextSelection(startPos + 1);
    } else {
      this._tiptapEditor.commands.setTextSelection(
        startPos + contentNode.nodeSize - 1
      );
    }
  }

  /**
   * Gets a snapshot of the current selection.
   */
  public getSelection(): Selection {
    const blocks: Block<Blocks>[] = [];

    this._tiptapEditor.state.doc.descendants((node, pos) => {
      if (node.type.spec.group !== "blockContent") {
        return true;
      }

      if (
        pos + node.nodeSize < this._tiptapEditor.state.selection.from ||
        pos > this._tiptapEditor.state.selection.to
      ) {
        return true;
      }

      blocks.push(
        nodeToBlock(
          this._tiptapEditor.state.doc.resolve(pos).node(),
          this.schema,
          this.blockCache
        )
      );

      return false;
    });

    return { blocks: blocks };
  }

  /**
   * Inserts new blocks into the editor. If a block's `id` is undefined, BlockNote generates one automatically. Throws an
   * error if the reference block could not be found.
   * @param blocksToInsert An array of partial blocks that should be inserted.
   * @param referenceBlock An identifier for an existing block, at which the new blocks should be inserted.
   * @param placement Whether the blocks should be inserted just before, just after, or nested inside the
   * `referenceBlock`. Inserts the blocks at the start of the existing block's children if "nested" is used.
   */
  public insertBlocks(
    blocksToInsert: PartialBlock<Blocks>[],
    referenceBlock: BlockIdentifier,
    placement: "before" | "after" | "nested" = "before"
  ): void {
    insertBlocks(blocksToInsert, referenceBlock, placement, this._tiptapEditor);
  }

  /**
   * Updates an existing block in the editor. Since updatedBlock is a PartialBlock object, some fields might not be
   * defined. These undefined fields are kept as-is from the existing block. Throws an error if the block to update could
   * not be found.
   * @param blockToUpdate The block that should be updated.
   * @param update A partial block which defines how the existing block should be changed.
   */
  public updateBlock(
    blockToUpdate: BlockIdentifier,
    update: PartialBlock<Blocks>
  ) {
    updateBlock(blockToUpdate, update, this._tiptapEditor);
  }

  /**
   * Removes existing blocks from the editor. Throws an error if any of the blocks could not be found.
   * @param blocksToRemove An array of identifiers for existing blocks that should be removed.
   */
  public removeBlocks(blocksToRemove: BlockIdentifier[]) {
    removeBlocks(blocksToRemove, this._tiptapEditor);
  }

  /**
   * Replaces existing blocks in the editor with new blocks. If the blocks that should be removed are not adjacent or
   * are at different nesting levels, `blocksToInsert` will be inserted at the position of the first block in
   * `blocksToRemove`. Throws an error if any of the blocks to remove could not be found.
   * @param blocksToRemove An array of blocks that should be replaced.
   * @param blocksToInsert An array of partial blocks to replace the old ones with.
   */
  public replaceBlocks(
    blocksToRemove: BlockIdentifier[],
    blocksToInsert: PartialBlock<Blocks>[]
  ) {
    replaceBlocks(blocksToRemove, blocksToInsert, this._tiptapEditor);
  }

  /**
   * Gets the active text styles at the text cursor position.
   */
  public getActiveStyles() {
    const styles: Styles = {};
    const marks = this._tiptapEditor.state.selection.$to.marks();

    const toggleStyles = new Set<ToggledStyle>([
      "bold",
      "italic",
      "underline",
      "strike",
    ]);
    const colorStyles = new Set<ColorStyle>(["textColor", "backgroundColor"]);

    for (const mark of marks) {
      if (toggleStyles.has(mark.type.name as ToggledStyle)) {
        styles[mark.type.name as ToggledStyle] = true;
      } else if (colorStyles.has(mark.type.name as ColorStyle)) {
        styles[mark.type.name as ColorStyle] = mark.attrs.color;
      }
    }

    return styles;
  }

  /**
   * Adds styles to the currently selected content.
   * @param styles The styles to add.
   */
  public addStyles(styles: Styles) {
    const toggleStyles = new Set<ToggledStyle>([
      "bold",
      "italic",
      "underline",
      "strike",
    ]);
    const colorStyles = new Set<ColorStyle>(["textColor", "backgroundColor"]);

    this._tiptapEditor.view.focus();

    for (const [style, value] of Object.entries(styles)) {
      if (toggleStyles.has(style as ToggledStyle)) {
        this._tiptapEditor.commands.setMark(style);
      } else if (colorStyles.has(style as ColorStyle)) {
        this._tiptapEditor.commands.setMark(style, { color: value });
      }
    }
  }

  /**
   * Removes styles from the currently selected content.
   * @param styles The styles to remove.
   */
  public removeStyles(styles: Styles) {
    this._tiptapEditor.view.focus();

    for (const style of Object.keys(styles)) {
      this._tiptapEditor.commands.unsetMark(style);
    }
  }

  /**
   * Toggles styles on the currently selected content.
   * @param styles The styles to toggle.
   */
  public toggleStyles(styles: Styles) {
    const toggleStyles = new Set<ToggledStyle>([
      "bold",
      "italic",
      "underline",
      "strike",
    ]);
    const colorStyles = new Set<ColorStyle>(["textColor", "backgroundColor"]);

    this._tiptapEditor.view.focus();

    for (const [style, value] of Object.entries(styles)) {
      if (toggleStyles.has(style as ToggledStyle)) {
        this._tiptapEditor.commands.toggleMark(style);
      } else if (colorStyles.has(style as ColorStyle)) {
        this._tiptapEditor.commands.toggleMark(style, { color: value });
      }
    }
  }

  /**
   * Gets the URL of the link at the current selection, and the currently selected text. If no link is active, the URL
   * is an empty string.
   */
  public getActiveLink() {
    const url = this._tiptapEditor.getAttributes("link").href;
    // TODO: Does this make sense? Shouldn't it get the actual link text?
    const text = this._tiptapEditor.state.doc.textBetween(
      this._tiptapEditor.state.selection.from,
      this._tiptapEditor.state.selection.to
    );

    return { text: text, url: url };
  }

  /**
   * Creates a new link to replace the selected content.
   * @param url The link URL.
   * @param text The text to display the link with.
   */
  public createLink(url: string, text?: string) {
    if (url === "") {
      return;
    }

    let { from, to } = this._tiptapEditor.state.selection;

    if (!text) {
      text = this._tiptapEditor.state.doc.textBetween(from, to);
    }

    const mark = this._tiptapEditor.schema.mark("link", { href: url });

    this._tiptapEditor.view.dispatch(
      this._tiptapEditor.view.state.tr
        .insertText(text, from, to)
        .addMark(from, from + text.length, mark)
    );
  }

  /**
   * Checks if the block containing the text cursor can be nested.
   */
  public canNestBlock() {
    const { startPos, depth } = getBlockInfoFromPos(
      this._tiptapEditor.state.doc,
      this._tiptapEditor.state.selection.from
    )!;

    return this._tiptapEditor.state.doc.resolve(startPos).index(depth - 1) > 0;
  }

  /**
   * Nests the block containing the text cursor into the block above it.
   */
  public nestBlock() {
    this._tiptapEditor.commands.sinkListItem("blockContainer");
  }

  /**
   * Checks if the block containing the text cursor is nested.
   */
  public canUnnestBlock() {
    const { depth } = getBlockInfoFromPos(
      this._tiptapEditor.state.doc,
      this._tiptapEditor.state.selection.from
    )!;

    return depth > 2;
  }

  /**
   * Lifts the block containing the text cursor out of its parent.
   */
  public unnestBlock() {
    this._tiptapEditor.commands.liftListItem("blockContainer");
  }

  /**
   * Serializes blocks into an HTML string. To better conform to HTML standards, children of blocks which aren't list
   * items are un-nested in the output HTML.
   * @param blocks An array of blocks that should be serialized into HTML.
   * @returns The blocks, serialized as an HTML string.
   */
  public async blocksToHTML(blocks: Block<Blocks>[]): Promise<string> {
    return blocksToHTML(blocks, this._tiptapEditor.schema);
  }

  /**
   * Parses blocks from an HTML string. Tries to create `Block` objects out of any HTML block-level elements, and
   * `InlineNode` objects from any HTML inline elements, though not all element types are recognized. If BlockNote
   * doesn't recognize an HTML element's tag, it will parse it as a paragraph or plain text.
   * @param html The HTML string to parse blocks from.
   * @returns The blocks parsed from the HTML string.
   */
  public async HTMLToBlocks(html: string): Promise<Block<Blocks>[]> {
    return HTMLToBlocks(html, this.schema, this._tiptapEditor.schema) as any; // TODO: fix type
  }

  /**
   * Serializes blocks into a Markdown string. The output is simplified as Markdown does not support all features of
   * BlockNote - children of blocks which aren't list items are un-nested and certain styles are removed.
   * @param blocks An array of blocks that should be serialized into Markdown.
   * @returns The blocks, serialized as a Markdown string.
   */
  public async blocksToMarkdown(blocks: Block<Blocks>[]): Promise<string> {
    return blocksToMarkdown(blocks, this._tiptapEditor.schema);
  }

  /**
   * Creates a list of blocks from a Markdown string. Tries to create `Block` and `InlineNode` objects based on
   * Markdown syntax, though not all symbols are recognized. If BlockNote doesn't recognize a symbol, it will parse it
   * as text.
   * @param markdown The Markdown string to parse blocks from.
   * @returns The blocks parsed from the Markdown string.
   */
  public async markdownToBlocks(markdown: string): Promise<Block<Blocks>[]> {
    return markdownToBlocks(
      markdown,
      this.schema,
      this._tiptapEditor.schema
    ) as any; // TODO: fix type
  }
}

// // Playground:
//
// let x = new BlockNoteEditor(); // default block types are supported
//
// // this breaks because "level" is not valid on paragraph
// x.updateBlock("", {
//   type: "paragraph",
//   content: "hello",
//   props: { level: "1" },
// });
//
// x.updateBlock("", {
//   type: "heading",
//   content: "hello",
//   props: { level: "1" },
// });
//
// let y = new BlockNoteEditor<{ paragraph: ParagraphBlockSpec }>();
//
// y.updateBlock("", { type: "paragraph", content: "hello", props: {} });
//
// // this breaks because "heading" is not a type on this editor
// y.updateBlock("", {
//   type: "heading",
//   content: "hello",
//   props: { level: "1" },
// });

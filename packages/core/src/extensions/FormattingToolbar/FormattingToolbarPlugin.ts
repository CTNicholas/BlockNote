import {
  Editor,
  isNodeSelection,
  isTextSelection,
  posToDOMRect,
} from "@tiptap/core";
import { EditorState, Plugin, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  FormattingToolbar,
  FormattingToolbarFactory,
  FormattingToolbarParams,
} from "./FormattingToolbarFactoryTypes";

// Same as TipTap bubblemenu plugin, but with these changes:
// https://github.com/ueberdosis/tiptap/pull/2596/files
export interface FormattingToolbarPluginProps {
  pluginKey: PluginKey;
  editor: Editor;
  formattingToolbarFactory: FormattingToolbarFactory;
  shouldShow?:
    | ((props: {
        editor: Editor;
        view: EditorView;
        state: EditorState;
        oldState?: EditorState;
        from: number;
        to: number;
      }) => boolean)
    | null;
}

export type FormattingToolbarViewProps = FormattingToolbarPluginProps & {
  view: EditorView;
};

export class FormattingToolbarView {
  public editor: Editor;

  public view: EditorView;

  public formattingToolbarParams: FormattingToolbarParams;

  public formattingToolbar: FormattingToolbar;

  public preventHide = false;

  public preventShow = false;

  public toolbarIsOpen = false;

  public shouldShow: Exclude<FormattingToolbarPluginProps["shouldShow"], null> =
    ({ view, state, from, to }) => {
      const { doc, selection } = state;
      const { empty } = selection;

      // Sometime check for `empty` is not enough.
      // Doubleclick an empty paragraph returns a node size of 2.
      // So we check also for an empty text size.
      const isEmptyTextBlock =
        !doc.textBetween(from, to).length && isTextSelection(state.selection);

      return !(!view.hasFocus() || empty || isEmptyTextBlock);
    };

  constructor({
    editor,
    formattingToolbarFactory,
    view,
    shouldShow,
  }: FormattingToolbarViewProps) {
    this.editor = editor;
    this.view = view;

    this.formattingToolbarParams = this.initFormattingToolbarParams();
    this.formattingToolbar = formattingToolbarFactory(
      this.formattingToolbarParams
    );

    if (shouldShow) {
      this.shouldShow = shouldShow;
    }

    this.view.dom.addEventListener("mousedown", this.viewMousedownHandler);
    this.view.dom.addEventListener("mouseup", this.viewMouseupHandler);
    this.view.dom.addEventListener("dragstart", this.dragstartHandler);

    this.editor.on("focus", this.focusHandler);
    this.editor.on("blur", this.blurHandler);
  }

  viewMousedownHandler = () => {
    this.preventShow = true;
  };

  viewMouseupHandler = () => {
    this.preventShow = false;
    setTimeout(() => this.update(this.editor.view));
  };

  dragstartHandler = () => {
    this.formattingToolbar.hide();
    this.toolbarIsOpen = false;
  };

  focusHandler = () => {
    // we use `setTimeout` to make sure `selection` is already updated
    setTimeout(() => this.update(this.editor.view));
  };

  blurHandler = ({ event }: { event: FocusEvent }) => {
    if (this.preventHide) {
      this.preventHide = false;

      return;
    }

    if (
      event?.relatedTarget &&
      this.formattingToolbar.element?.parentNode?.contains(
        event.relatedTarget as Node
      )
    ) {
      return;
    }

    if (this.toolbarIsOpen) {
      this.formattingToolbar.hide();
      this.toolbarIsOpen = false;
    }
  };

  update(view: EditorView, oldState?: EditorState) {
    const { state, composing } = view;
    const { doc, selection } = state;
    const isSame =
      oldState && oldState.doc.eq(doc) && oldState.selection.eq(selection);

    if (composing || isSame) {
      return;
    }

    // support for CellSelections
    const { ranges } = selection;
    const from = Math.min(...ranges.map((range) => range.$from.pos));
    const to = Math.max(...ranges.map((range) => range.$to.pos));

    const shouldShow = this.shouldShow?.({
      editor: this.editor,
      view,
      state,
      oldState,
      from,
      to,
    });

    // Checks if menu should be shown.
    if (
      !this.toolbarIsOpen &&
      !this.preventShow &&
      (shouldShow || this.preventHide)
    ) {
      this.updateFormattingToolbarParams();
      this.formattingToolbar.show(this.formattingToolbarParams);
      this.toolbarIsOpen = true;

      // TODO: Is this necessary? Also for other menu plugins.
      // Listener stops focus moving to the menu on click.
      this.formattingToolbar.element!.addEventListener("mousedown", (event) =>
        event.preventDefault()
      );

      return;
    }

    // Checks if menu should be updated.
    if (
      this.toolbarIsOpen &&
      !this.preventShow &&
      (shouldShow || this.preventHide)
    ) {
      this.updateFormattingToolbarParams();
      this.formattingToolbar.update(this.formattingToolbarParams);

      return;
    }

    // Checks if menu should be hidden.
    if (
      this.toolbarIsOpen &&
      !this.preventHide &&
      (!shouldShow || this.preventShow)
    ) {
      this.formattingToolbar.hide();
      this.toolbarIsOpen = false;

      // Listener stops focus moving to the menu on click.
      this.formattingToolbar.element!.removeEventListener(
        "mousedown",
        (event) => event.preventDefault()
      );

      return;
    }
  }

  destroy() {
    this.view.dom.removeEventListener("mousedown", this.viewMousedownHandler);
    this.view.dom.removeEventListener("mouseup", this.viewMouseupHandler);
    this.view.dom.removeEventListener("dragstart", this.dragstartHandler);

    this.editor.off("focus", this.focusHandler);
    this.editor.off("blur", this.blurHandler);
  }

  getSelectionBoundingBox() {
    const { state } = this.editor.view;
    const { selection } = state;

    // support for CellSelections
    const { ranges } = selection;
    const from = Math.min(...ranges.map((range) => range.$from.pos));
    const to = Math.max(...ranges.map((range) => range.$to.pos));

    if (isNodeSelection(selection)) {
      const node = this.editor.view.nodeDOM(from) as HTMLElement;

      if (node) {
        return node.getBoundingClientRect();
      }
    }

    return posToDOMRect(this.editor.view, from, to);
  }

  initFormattingToolbarParams(): FormattingToolbarParams {
    return {
      boldIsActive: this.editor.isActive("bold"),
      toggleBold: () => {
        this.editor.view.focus();
        this.editor.commands.toggleBold();
      },
      italicIsActive: this.editor.isActive("italic"),
      toggleItalic: () => {
        this.editor.view.focus();
        this.editor.commands.toggleItalic();
      },
      underlineIsActive: this.editor.isActive("underline"),
      toggleUnderline: () => {
        this.editor.view.focus();
        this.editor.commands.toggleUnderline();
      },
      strikeIsActive: this.editor.isActive("strike"),
      toggleStrike: () => {
        this.editor.view.focus();
        this.editor.commands.toggleStrike();
      },
      hyperlinkIsActive: this.editor.isActive("link"),
      activeHyperlinkUrl: this.editor.getAttributes("link").href
        ? this.editor.getAttributes("link").href
        : "",
      activeHyperlinkText: this.editor.state.doc.textBetween(
        this.editor.state.selection.from,
        this.editor.state.selection.to
      ),
      setHyperlink: (url: string, text?: string) => {
        if (url === "") {
          return;
        }

        let { from, to } = this.editor.state.selection;

        if (!text) {
          text = this.editor.state.doc.textBetween(from, to);
        }

        const mark = this.editor.schema.mark("link", { href: url });

        this.editor.view.dispatch(
          this.editor.view.state.tr
            .insertText(text, from, to)
            .addMark(from, from + text.length, mark)
        );
        this.editor.view.focus();
      },
      paragraphIsActive:
        this.editor.state.selection.$from.node().type.name === "textContent",
      setParagraph: () => {
        this.editor.view.focus();
        this.editor.commands.BNSetContentType(
          this.editor.state.selection.from,
          "textContent"
        );
      },
      headingIsActive:
        this.editor.state.selection.$from.node().type.name === "headingContent",
      activeHeadingLevel:
        this.editor.state.selection.$from.node().attrs["headingLevel"],
      setHeading: (level: string = "1") => {
        this.editor.view.focus();
        this.editor.commands.BNSetContentType(
          this.editor.state.selection.from,
          "headingContent",
          {
            headingLevel: level,
          }
        );
      },
      listItemIsActive:
        this.editor.state.selection.$from.node().type.name ===
        "listItemContent",
      activeListItemType:
        this.editor.state.selection.$from.node().attrs["listItemType"],
      setListItem: (type: string = "unordered") => {
        this.editor.view.focus();
        this.editor.commands.BNSetContentType(
          this.editor.state.selection.from,
          "listItemContent",
          {
            listItemType: type,
          }
        );
      },
      selectionBoundingBox: this.getSelectionBoundingBox(),
      editorElement: this.editor.options.element,
    };
  }

  updateFormattingToolbarParams() {
    this.formattingToolbarParams.boldIsActive = this.editor.isActive("bold");
    this.formattingToolbarParams.italicIsActive =
      this.editor.isActive("italic");
    this.formattingToolbarParams.underlineIsActive =
      this.editor.isActive("underline");
    this.formattingToolbarParams.strikeIsActive =
      this.editor.isActive("strike");
    this.formattingToolbarParams.hyperlinkIsActive =
      this.editor.isActive("link");
    this.formattingToolbarParams.activeHyperlinkUrl = this.editor.getAttributes(
      "link"
    ).href
      ? this.editor.getAttributes("link").href
      : "";
    this.formattingToolbarParams.activeHyperlinkText =
      this.editor.state.doc.textBetween(
        this.editor.state.selection.from,
        this.editor.state.selection.to
      );

    this.formattingToolbarParams.paragraphIsActive =
      this.editor.state.selection.$from.node().type.name === "textContent";
    this.formattingToolbarParams.headingIsActive =
      this.editor.state.selection.$from.node().type.name === "headingContent";
    this.formattingToolbarParams.activeHeadingLevel =
      this.editor.state.selection.$from.node().attrs["headingLevel"];
    this.formattingToolbarParams.listItemIsActive =
      this.editor.state.selection.$from.node().type.name === "listItemContent";
    this.formattingToolbarParams.activeListItemType =
      this.editor.state.selection.$from.node().attrs["listItemType"];

    this.formattingToolbarParams.selectionBoundingBox =
      this.getSelectionBoundingBox();
  }
}

export const createFormattingToolbarPlugin = (
  options: FormattingToolbarPluginProps
) => {
  return new Plugin({
    key: new PluginKey("FormattingToolbarPlugin"),
    view: (view) => new FormattingToolbarView({ view, ...options }),
  });
};
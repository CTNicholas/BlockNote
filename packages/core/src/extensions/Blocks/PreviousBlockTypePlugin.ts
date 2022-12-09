import { findChildren } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

const PLUGIN_KEY = new PluginKey(`previous-blocks`);

const nodeAttributes: Record<string, string> = {
  listItemType: "list-item-type",
  listItemIndex: "list-item-index",
  headingLevel: "heading-level",
  type: "type",
  depth: "depth",
  "depth-change": "depth-change",
};

/**
 * This plugin tracks transformation of Block node attributes, so we can support CSS transitions.
 *
 * Problem it solves: ProseMirror recreates the DOM when transactions happen. So when a transaction changes a Node attribute,
 * it results in a completely new DOM element. This means CSS transitions don't work.
 *
 * Solution: When attributes change on a node, this plugin sets a data-* attribute with the "previous" value. This way we can still use CSS transitions. (See block.module.css)
 */
export const PreviousBlockTypePlugin = () => {
  return new Plugin({
    key: PLUGIN_KEY,
    view(_editorView) {
      return {
        update: async (view, _prevState) => {
          if (this.key?.getState(view.state).updatedBlocks.size > 0) {
            // use setTimeout 0 to clear the decorations so that at least
            // for one DOM-render the decorations have been applied
            setTimeout(() => {
              view.dispatch(
                view.state.tr.setMeta(PLUGIN_KEY, { clearUpdate: true })
              );
            }, 0);
          }
        },
      };
    },
    state: {
      init() {
        return {
          prevBlockAttrs: {} as any,
          updatedBlocks: new Set<string>(),
          prevTransactionOldAttrs: {} as any,
        };
      },

      apply(transaction, prev, oldState, newState) {
        prev.updatedBlocks.clear();

        if (!transaction.docChanged || oldState.doc.eq(newState.doc)) {
          return prev;
        }

        const prevTransactionOldAttrs = {} as any;

        const oldNodes = findChildren(oldState.doc, (node) => node.attrs.id);
        const oldNodesById = new Map(
          oldNodes.map((node) => [node.node.attrs.id, node])
        );
        const newNodes = findChildren(newState.doc, (node) => node.attrs.id);

        for (let node of newNodes) {
          const oldNode = oldNodesById.get(node.node.attrs.id);

          const oldContentNode = oldNode?.node.firstChild;
          const newContentNode = node.node.firstChild;

          if (oldNode && oldContentNode && newContentNode) {
            const newAttrs = {
              listItemType: newContentNode.attrs.listItemType,
              listItemIndex: newContentNode.attrs.listItemIndex,
              headingLevel: newContentNode.attrs.headingLevel,
              type: newContentNode.type.name,
              depth: newState.doc.resolve(node.pos).depth,
            };

            let oldAttrs = {
              listItemType: oldContentNode.attrs.listItemType,
              listItemIndex: oldContentNode.attrs.listItemIndex,
              headingLevel: oldContentNode.attrs.headingLevel,
              type: oldContentNode.type.name,
              depth: oldState.doc.resolve(oldNode.pos).depth,
            };

            prevTransactionOldAttrs[node.node.attrs.id] = oldAttrs;

            // Whenever a transaction is appended by the OrderedListItemIndexPlugin, it's given the metadata:
            // { "orderedListIndexing": true }
            // These appended transactions happen immediately after any transaction which causes ordered list item
            // indices to require updating, including those which trigger animations. Therefore, these animations are
            // immediately overridden when the PreviousBlockTypePlugin processes the appended transaction, despite only
            // the listItemIndex attribute changing. To solve this, oldAttrs must be edited for transactions with the
            // "orderedListIndexing" metadata, so the correct animation can be re-triggered.
            if (transaction.getMeta("orderedListIndexing")) {
              // If the block existed before the transaction, gets the attributes from before the previous transaction
              // (i.e. the transaction that caused list item indices to need updating).
              if (node.node.attrs.id in prev.prevTransactionOldAttrs) {
                oldAttrs = prev.prevTransactionOldAttrs[node.node.attrs.id];
              }

              // Stops list item indices themselves being animated (looks smoother), unless the block's content type is
              // changing from an ordered list item to something else.
              if (newAttrs.listItemIndex) {
                oldAttrs.listItemIndex = newAttrs.listItemIndex;
              }
            }

            prev.prevBlockAttrs[node.node.attrs.id] = oldAttrs;

            // TODO: faster deep equal?
            if (JSON.stringify(oldAttrs) !== JSON.stringify(newAttrs)) {
              (oldAttrs as any)["depth-change"] =
                oldAttrs.depth - newAttrs.depth;

              // for debugging:
              console.log(
                "id:",
                node.node.attrs.id,
                "previousBlockTypePlugin changes detected, oldAttrs",
                oldAttrs,
                "new",
                newAttrs
              );

              prev.updatedBlocks.add(node.node.attrs.id);
            }
          }
        }

        prev.prevTransactionOldAttrs = prevTransactionOldAttrs;

        return prev;
      },
    },
    props: {
      decorations(state) {
        const pluginState = (this as Plugin).getState(state);
        if (pluginState.updatedBlocks.size === 0) {
          return undefined;
        }

        const decorations: Decoration[] = [];

        state.doc.descendants((node, pos) => {
          if (!node.attrs.id) {
            return;
          }

          if (!pluginState.updatedBlocks.has(node.attrs.id)) {
            return;
          }

          const prevAttrs = pluginState.prevBlockAttrs[node.attrs.id];
          const decorationAttrs: any = {};

          for (let [nodeAttr, val] of Object.entries(prevAttrs)) {
            decorationAttrs["data-prev-" + nodeAttributes[nodeAttr]] =
              val || "none";
          }

          // for debugging:
          // console.log(
          //   "previousBlockTypePlugin committing decorations",
          //   decorationAttrs
          // );

          const decoration = Decoration.node(pos, pos + node.nodeSize, {
            ...decorationAttrs,
          });

          decorations.push(decoration);
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
};

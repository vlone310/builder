import { defineComponent, fields } from "@builder/core";
import { type BuilderComponentProps, RichText } from "@builder/react";
import { z } from "zod";
import type { DataServices, OddsRow } from "../data";

const oddsTableProps = z.object({
  league: fields.dynamicSelect({ source: "leagues" }),
  rows: z.number().int().min(1).max(50).default(10),
  title: fields.richText().optional(),
});

function OddsTable({
  props,
  data,
  slots,
}: BuilderComponentProps<typeof oddsTableProps, OddsRow[], "footer">) {
  return (
    <div className="odds-table">
      <RichText value={props.title} className="odds-table__title" />
      {data.length === 0 ? (
        <p className="odds-table__empty">No matches right now.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Match</th>
              <th>1</th>
              <th>X</th>
              <th>2</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.match}>
                <td>{row.match}</td>
                <td>{row.home.toFixed(2)}</td>
                <td>{row.draw.toFixed(2)}</td>
                <td>{row.away.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {slots.footer}
    </div>
  );
}

export const oddsTable = defineComponent({
  id: "igaming/odds-table",
  version: "1.0.0",
  label: "Odds Table",
  category: "Sports",
  props: oddsTableProps,
  slots: { footer: { allow: ["core/*", "igaming/disclaimer"] } },
  constraints: { placement: "section" },
  loader: ({ props, ctx }) => (ctx.data as DataServices).odds(props.league, props.rows),
  render: OddsTable,
});

const DISCLAIMERS = {
  uk: "18+ only. Gamble responsibly. BeGambleAware.org",
  eu: "18+ only. Play responsibly. Terms apply.",
} as const;

const disclaimerProps = z.object({ variant: z.enum(["uk", "eu"]) });

export const disclaimer = defineComponent({
  id: "igaming/disclaimer",
  version: "1.0.0",
  label: "Responsible gambling disclaimer",
  category: "Compliance",
  props: disclaimerProps,
  render: ({ props }: BuilderComponentProps<typeof disclaimerProps>) => (
    <p className="disclaimer">{DISCLAIMERS[props.variant]}</p>
  ),
});

export const igamingLibrary = [oddsTable, disclaimer];

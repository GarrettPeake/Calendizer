import type { ReactNode } from 'react';
import { InfoIcon } from './icons';

/** A section heading with an optional leading icon and a hover tooltip (native
 *  title) explaining what the section is for. */
export function SectionHeader(props: { icon?: ReactNode; title: string; hint: string }) {
  return (
    <h2 className="sec-head" title={props.hint}>
      {props.icon ? <span className="sec-ico">{props.icon}</span> : null}
      <span className="sec-title">{props.title}</span>
      <InfoIcon className="sec-info" />
    </h2>
  );
}

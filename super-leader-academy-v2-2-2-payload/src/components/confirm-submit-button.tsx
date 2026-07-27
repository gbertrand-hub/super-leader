"use client";

import type {ButtonHTMLAttributes, MouseEvent} from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  confirmation: string;
};

export function ConfirmSubmitButton({confirmation, onClick, ...props}: Props) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (!window.confirm(confirmation)) event.preventDefault();
  }

  return <button {...props} type={props.type ?? "submit"} onClick={handleClick} />;
}

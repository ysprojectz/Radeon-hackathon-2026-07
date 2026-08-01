import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import React from "react";

import { SkipLink } from "@/components/layout/SkipLink";

describe("Accessibility landmarks", () => {
  test("skip link targets the main content landmark", async () => {
    const { container } = render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(SkipLink),
        React.createElement(
          "main",
          { id: "main-content", "aria-label": "ACOS workspace" },
          React.createElement("h1", null, "Claims dashboard")
        )
      )
    );

    const skipLink = screen.getByRole("link", { name: /skip to main content/i });
    const main = screen.getByRole("main", { name: /acos workspace/i });

    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(main).toHaveAttribute("id", "main-content");

    const results = await axe(container);
    expect(results.violations).toHaveLength(0);
  });
});

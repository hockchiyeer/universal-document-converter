import {
  Before,
  Given,
  Then,
  When,
} from "@badeball/cypress-cucumber-preprocessor";

type ConversionLabel = "URL" | "HTML" | "Word" | "PDF";
type ConversionRequestBody = {
  type: string;
  payload: string;
  format: string;
};

type ApiBehavior =
  | { kind: "unexpected" }
  | { kind: "success"; contentType: string; delay?: number }
  | { kind: "failure"; message: string };

const conversionTabSelectors: Record<ConversionLabel, string> = {
  URL: '[data-cy="conversion-tab-url"]',
  HTML: '[data-cy="conversion-tab-html"]',
  Word: '[data-cy="conversion-tab-word"]',
  PDF: '[data-cy="conversion-tab-pdf"]',
};

const exportSelectors: Record<string, string> = {
  "PDF Document": '[data-cy="export-pdf"]',
  "PNG Images (ZIP)": '[data-cy="export-image"]',
};

const validFileMeta: Record<
  Exclude<ConversionLabel, "URL">,
  { mimeType: string; content: string }
> = {
  HTML: { mimeType: "text/html", content: "<html><body>Document</body></html>" },
  Word: {
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    content: "mock word document",
  },
  PDF: { mimeType: "application/pdf", content: "%PDF-1.4 mock pdf" },
};

const invalidFileMeta: Record<
  Exclude<ConversionLabel, "URL">,
  { mimeType: string; content: string }
> = {
  HTML: { mimeType: "text/plain", content: "plain text" },
  Word: { mimeType: "text/html", content: "<html>not word</html>" },
  PDF: { mimeType: "text/html", content: "<html>not pdf</html>" },
};

let apiBehavior: ApiBehavior;
let conversionRequests: ConversionRequestBody[];
let lastConversionRequest: ConversionRequestBody | null;

const asConversionLabel = (label: string): ConversionLabel => {
  if (["URL", "HTML", "Word", "PDF"].includes(label)) {
    return label as ConversionLabel;
  }

  throw new Error(`Unknown conversion label: ${label}`);
};

const parseRequestBody = (body: unknown): ConversionRequestBody => {
  if (typeof body === "string") {
    return JSON.parse(body) as ConversionRequestBody;
  }

  return body as ConversionRequestBody;
};

const buildFile = (
  type: Exclude<ConversionLabel, "URL">,
  fileName: string,
  validity: "valid" | "invalid",
  content?: string,
) => {
  const meta = validity === "valid" ? validFileMeta[type] : invalidFileMeta[type];

  return {
    contents: Cypress.Buffer.from(content ?? meta.content),
    fileName,
    mimeType: meta.mimeType,
  };
};

Before(() => {
  apiBehavior = { kind: "unexpected" };
  conversionRequests = [];
  lastConversionRequest = null;
});

Given("I open the converter application", () => {
  cy.intercept("POST", "/api/convert", (req) => {
    const requestBody = parseRequestBody(req.body);
    conversionRequests.push(requestBody);
    lastConversionRequest = requestBody;

    if (apiBehavior.kind === "success") {
      const body =
        apiBehavior.contentType === "application/zip"
          ? "PK\u0003\u0004 mock zip"
          : "%PDF-1.4 mock pdf";

      req.reply({
        delay: apiBehavior.delay,
        statusCode: 200,
        headers: {
          "content-disposition": "attachment; filename=converted",
          "content-type": apiBehavior.contentType,
        },
        body,
      });
      return;
    }

    if (apiBehavior.kind === "failure") {
      req.reply({
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: { error: apiBehavior.message },
      });
      return;
    }

    req.reply({
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: { error: "Unexpected conversion request" },
    });
  }).as("convert");

  cy.visit("/");
  cy.window().then((win) => {
    cy.stub(win.URL, "createObjectURL").returns("blob:mock-download");
    cy.stub(win.URL, "revokeObjectURL").as("revokeObjectURL");
    cy.stub(win.HTMLAnchorElement.prototype, "click").as("downloadClick");
  });
});

Given("the conversion API will return an {string} file", (contentType: string) => {
  apiBehavior = { kind: "success", contentType };
});

Given(
  "the conversion API will return an {string} file after {int} milliseconds",
  (contentType: string, delay: number) => {
    apiBehavior = { kind: "success", contentType, delay };
  },
);

Given("the conversion API will fail with {string}", (message: string) => {
  apiBehavior = { kind: "failure", message };
});

Then("I should see the header {string}", (headerText: string) => {
  cy.get('[data-cy="app-heading"]').should("contain.text", headerText);
});

Then("the {string} conversion option should be selected", (type: string) => {
  cy.get(conversionTabSelectors[asConversionLabel(type)]).should(
    "have.attr",
    "aria-pressed",
    "true",
  );
});

Then("the URL input should be visible", () => {
  cy.get('[data-cy="url-input"]').should("be.visible");
});

Then("the {string} export format should be selected", (formatLabel: string) => {
  cy.get(exportSelectors[formatLabel]).should("have.attr", "aria-pressed", "true");
});

Then("the Convert button should be enabled", () => {
  cy.get('[data-cy="convert-button"]').should("be.enabled");
});

Then("the Convert button should be disabled", () => {
  cy.get('[data-cy="convert-button"]').should("be.disabled");
});

When("I click on the {string} option", (option: string) => {
  cy.get(conversionTabSelectors[asConversionLabel(option)]).click();
});

When("I enter the URL {string}", (url: string) => {
  cy.get('[data-cy="url-input"]').clear().type(url);
});

When("I click {string}", (buttonText: string) => {
  if (buttonText === "Convert") {
    cy.get('[data-cy="convert-button"]').click();
    return;
  }

  cy.contains("button", buttonText).click();
});

When(
  "I upload a valid {string} file named {string}",
  (type: string, fileName: string) => {
    const fileType = asConversionLabel(type) as Exclude<ConversionLabel, "URL">;
    cy.get('[data-cy="file-input"]').selectFile(buildFile(fileType, fileName, "valid"), {
      force: true,
    });
  },
);

When(
  "I upload an invalid {string} file named {string}",
  (type: string, fileName: string) => {
    const fileType = asConversionLabel(type) as Exclude<ConversionLabel, "URL">;
    cy.get('[data-cy="file-input"]').selectFile(
      buildFile(fileType, fileName, "invalid"),
      { force: true },
    );
  },
);

When(
  "I drag and drop a valid {string} file named {string}",
  (type: string, fileName: string) => {
    const fileType = asConversionLabel(type) as Exclude<ConversionLabel, "URL">;
    cy.get('[data-cy="file-drop-zone"]').selectFile(
      buildFile(fileType, fileName, "valid"),
      { action: "drag-drop" },
    );
  },
);

When(
  "I drag and drop an invalid {string} file named {string}",
  (type: string, fileName: string) => {
    const fileType = asConversionLabel(type) as Exclude<ConversionLabel, "URL">;
    cy.get('[data-cy="file-drop-zone"]').selectFile(
      buildFile(fileType, fileName, "invalid"),
      { action: "drag-drop" },
    );
  },
);

When("I remove the selected file", () => {
  cy.get('[data-cy="remove-file"]').click();
});

When("I choose the {string} export format", (formatLabel: string) => {
  cy.get(exportSelectors[formatLabel]).click();
});

When(
  "I provide valid {string} input named {string} with content {string}",
  (type: string, fileName: string, content: string) => {
    const conversionType = asConversionLabel(type);

    if (conversionType === "URL") {
      cy.get('[data-cy="url-input"]').clear().type(content);
      return;
    }

    cy.get(conversionTabSelectors[conversionType]).click();
    cy.get('[data-cy="file-input"]').selectFile(
      buildFile(conversionType, fileName, "valid", content),
      { force: true },
    );
  },
);

Then("I should see the upload guidance {string}", (guidance: string) => {
  cy.contains(guidance).should("be.visible");
});

Then("the file input should accept {string}", (accepts: string) => {
  cy.get('[data-cy="file-input"]').should("have.attr", "accept", accepts);
});

Then("the export format controls should be {string}", (visibility: string) => {
  const assertion = visibility === "visible" ? "be.visible" : "not.exist";
  cy.get('[data-cy="export-format"]').should(assertion);
});

Then("I should see an error {string}", (errorText: string) => {
  cy.get('[data-cy="error-message"]').should("contain.text", errorText);
});

Then("I should not see an error", () => {
  cy.get('[data-cy="error-message"]').should("not.exist");
});

Then("I should see the selected file {string}", (fileName: string) => {
  cy.get('[data-cy="selected-file-name"]').should("contain.text", fileName);
});

Then("I should see a selected file size", () => {
  cy.get('[data-cy="selected-file-size"]').invoke("text").should("match", /KB$/);
});

Then("I should not see a selected file", () => {
  cy.get('[data-cy="selected-file-name"]').should("not.exist");
});

Then("the conversion should start", () => {
  cy.get('[data-cy="convert-button"]').should("contain.text", "Converting...");
});

Then("no conversion request should be sent", () => {
  cy.wait(100);
  cy.then(() => {
    expect(conversionRequests).to.have.length(0);
  });
});

Then(
  "a conversion request should be sent with type {string} and format {string}",
  (type: string, format: string) => {
    cy.wait("@convert").then((interception) => {
      const requestBody = parseRequestBody(interception.request.body);
      lastConversionRequest = requestBody;

      expect(requestBody.type).to.eq(type);
      expect(requestBody.format).to.eq(format);
    });
  },
);

Then("the conversion request payload should match {string}", (payload: string) => {
  cy.then(() => {
    expect(lastConversionRequest).not.to.equal(null);
    const actualPayload = lastConversionRequest!.payload;

    if (payload === "base64") {
      expect(actualPayload).to.be.a("string").and.not.be.empty;
      expect(actualPayload).to.match(/^[A-Za-z0-9+/]+={0,2}$/);
      return;
    }

    expect(actualPayload).to.eq(payload);
  });
});

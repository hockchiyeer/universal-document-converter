Feature: Document Converter

  Background:
    Given I open the converter application

  Scenario: Application loads with URL conversion defaults
    Then I should see the header "Document Converter"
    And the "URL" conversion option should be selected
    And the URL input should be visible
    And the "PDF Document" export format should be selected
    And the Convert button should be enabled

  Scenario Outline: Conversion type controls show matching upload constraints
    When I click on the "<type>" option
    Then the "<type>" conversion option should be selected
    And I should see the upload guidance "<guidance>"
    And the file input should accept "<accepts>"
    And the export format controls should be "<visibility>"

    Examples:
      | type | guidance                          | accepts                                                                                              | visibility |
      | HTML | HTML files only (.html, .htm)     | .html,.htm,text/html                                                                                 | visible    |
      | Word | Word Documents only (.docx, .doc) | .docx,.doc,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document | visible    |
      | PDF  | PDF files only (.pdf)             | application/pdf                                                                                      | hidden     |

  Scenario Outline: Empty conversions show validation errors
    When I click on the "<type>" option
    And I click "Convert"
    Then I should see an error "<error>"
    And no conversion request should be sent

    Examples:
      | type | error                       |
      | URL  | Please enter a valid URL.   |
      | HTML | Please upload a file first. |
      | Word | Please upload a file first. |
      | PDF  | Please upload a file first. |

  Scenario Outline: Invalid URL values are rejected before conversion
    When I enter the URL "<url>"
    And I click "Convert"
    Then I should see an error "Please enter a valid URL."
    And no conversion request should be sent

    Examples:
      | url                    |
      | not-a-url              |
      | ftp://example.com/file |

  Scenario Outline: Invalid file uploads are rejected before conversion
    When I click on the "<type>" option
    And I upload an invalid "<type>" file named "<filename>"
    Then I should see an error "<error>"
    And I should not see a selected file
    When I click "Convert"
    Then I should see an error "Please upload a file first."
    And no conversion request should be sent

    Examples:
      | type | filename     | error                                           |
      | HTML | notes.txt    | Please upload a valid HTML file.               |
      | Word | article.html | Please upload a valid Word Document (.docx or .doc). |
      | PDF  | article.html | Please upload a valid PDF Document.            |

  Scenario Outline: Valid file uploads show details and can be removed
    When I click on the "<type>" option
    And I upload a valid "<type>" file named "<filename>"
    Then I should see the selected file "<filename>"
    And I should see a selected file size
    When I remove the selected file
    Then I should not see a selected file
    And I should see the upload guidance "<guidance>"

    Examples:
      | type | filename      | guidance                          |
      | HTML | article.html  | HTML files only (.html, .htm)     |
      | Word | proposal.docx | Word Documents only (.docx, .doc) |
      | PDF  | brochure.pdf  | PDF files only (.pdf)             |

  Scenario: Switching conversion types clears selected files and errors
    When I click on the "HTML" option
    And I upload a valid "HTML" file named "article.html"
    Then I should see the selected file "article.html"
    When I click on the "Word" option
    Then I should not see a selected file
    And I should not see an error
    And I should see the upload guidance "Word Documents only (.docx, .doc)"

  Scenario: Drag and drop uses the same file validation rules
    When I click on the "HTML" option
    And I drag and drop an invalid "HTML" file named "manual.pdf"
    Then I should see an error "Please upload a valid HTML file."
    When I drag and drop a valid "HTML" file named "dropped.htm"
    Then I should see the selected file "dropped.htm"
    And I should not see an error

  Scenario Outline: Non-PDF conversions send the selected export format
    Given the conversion API will return an "<responseType>" file
    When I provide valid "<type>" input named "<filename>" with content "<content>"
    And I choose the "<formatLabel>" export format
    And I click "Convert"
    Then a conversion request should be sent with type "<requestType>" and format "<format>"
    And the conversion request payload should match "<payload>"
    And the Convert button should be enabled

    Examples:
      | type | filename      | content                           | formatLabel      | requestType | format | payload                         | responseType     |
      | URL  |               | https://example.com/report        | PDF Document     | url         | pdf    | https://example.com/report      | application/pdf  |
      | URL  |               | https://example.com/gallery       | PNG Images (ZIP) | url         | image  | https://example.com/gallery     | application/zip  |
      | HTML | article.html  | <html><body>Article</body></html> | PDF Document     | html        | pdf    | <html><body>Article</body></html> | application/pdf  |
      | HTML | article.html  | <html><body>Article</body></html> | PNG Images (ZIP) | html        | image  | <html><body>Article</body></html> | application/zip  |
      | Word | proposal.docx | sample word document              | PDF Document     | word        | pdf    | base64                          | application/pdf  |
      | Word | proposal.docx | sample word document              | PNG Images (ZIP) | word        | image  | base64                          | application/zip  |

  Scenario: PDF conversions always request image ZIP output
    Given the conversion API will return an "application/zip" file
    When I click on the "PDF" option
    And I upload a valid "PDF" file named "brochure.pdf"
    And I click "Convert"
    Then a conversion request should be sent with type "pdf" and format "image"
    And the conversion request payload should match "base64"
    And the export format controls should be "hidden"

  Scenario: API failures are shown without trapping the converter in a loading state
    Given the conversion API will fail with "Renderer exploded"
    When I enter the URL "https://example.com/broken"
    And I click "Convert"
    Then a conversion request should be sent with type "url" and format "pdf"
    And I should see an error "Renderer exploded"
    And the Convert button should be enabled

  Scenario: Loading state prevents duplicate conversions
    Given the conversion API will return an "application/pdf" file after 500 milliseconds
    When I enter the URL "https://example.com/slow"
    And I click "Convert"
    Then the conversion should start
    And the Convert button should be disabled
    Then a conversion request should be sent with type "url" and format "pdf"
    And the Convert button should be enabled

  Scenario: Leaving PDF mode restores the default PDF export for other converters
    When I click on the "HTML" option
    And I choose the "PNG Images (ZIP)" export format
    Then the "PNG Images (ZIP)" export format should be selected
    When I click on the "PDF" option
    Then the export format controls should be "hidden"
    When I click on the "URL" option
    Then the "PDF Document" export format should be selected

import { FantiaCrawler } from "@mdcz/runtime/crawler/sites/fantia";
import { Website } from "@mdcz/shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("FantiaCrawler", () => {
  it("parses product detail pages from direct products URL", async () => {
    const cases = [
      {
        number: "FAN-123",
        detailUrl: "https://fantia.jp/products/FAN123",
        detailHtml: `
          <html>
            <head>
              <title>FAN123 Product Title - fantia</title>
              <meta property="og:image" content="https://fantia.jp/blurred_ogp/cover1.jpg" />
              <script type="application/ld+json">
                {"fanclub_user_name":"CreatorA","tag":"Tag1,Tag2,Tag3","uploadDate":"2023-01-15"}
              </script>
            </head>
            <body>
              <div class="product-description">Product description text</div>
            </body>
          </html>
        `,
        assert: (data: Awaited<ReturnType<FantiaCrawler["crawl"]>>) => {
          if (!data.result.success) {
            throw new Error("expected success");
          }
          expect(data.result.data.website).toBe(Website.FANTIA);
          expect(data.result.data.number).toBe("FAN-123");
          expect(data.result.data.title).toBe("FAN123 Product Title - fantia");
          expect(data.result.data.actors).toEqual(["CreatorA"]);
          expect(data.result.data.publisher).toBe("CreatorA");
          expect(data.result.data.studio).toBe("CreatorA");
          expect(data.result.data.director).toBe("CreatorA");
          expect(data.result.data.genres).toEqual(["Tag1", "Tag2", "Tag3"]);
          expect(data.result.data.release_date).toBe("2023-01-15");
          expect(data.result.data.thumb_url).toBe("https://fantia.jp/main/cover1.jpg");
          expect(data.result.data.scene_images).toEqual(["https://fantia.jp/main/cover1.jpg"]);
          expect(data.result.data.plot).toBe("Product description text");
        },
      },
      {
        number: "FANTIA-12345",
        detailUrl: "https://fantia.jp/products/12345",
        detailHtml: `
          <html>
            <head>
              <title>Fantia Product 12345 - fantia</title>
              <meta property="og:image" content="https://fantia.jp/blurred_ogp/cover2.jpg" />
              <script type="application/ld+json">
                {"fanclub_user_name":"CreatorB","tag":"GenreX","uploadDate":"2024-06-01"}
              </script>
            </head>
            <body>
              <div class="product-description">Another product description</div>
            </body>
          </html>
        `,
        assert: (data: Awaited<ReturnType<FantiaCrawler["crawl"]>>) => {
          if (!data.result.success) {
            throw new Error("expected success");
          }
          expect(data.result.data.number).toBe("FANTIA-12345");
          expect(data.result.data.publisher).toBe("CreatorB");
          expect(data.result.data.genres).toEqual(["GenreX"]);
          expect(data.result.data.release_date).toBe("2024-06-01");
          expect(data.result.data.thumb_url).toBe("https://fantia.jp/main/cover2.jpg");
        },
      },
    ];

    for (const { number, detailUrl, detailHtml, assert } of cases) {
      const fixtures = new Map<string, string>([[detailUrl, detailHtml]]);
      const crawler = new FantiaCrawler(withGateway(new FixtureNetworkClient(fixtures)));

      const response = await crawler.crawl({
        number,
        site: Website.FANTIA,
      });

      expect(response.result.success).toBe(true);
      assert(response as Awaited<ReturnType<FantiaCrawler["crawl"]>>);
    }
  });

  it("falls back to posts URL when products URL is not found", async () => {
    const number = "FAN-456";
    const productsUrl = "https://fantia.jp/products/FAN456";
    const postsUrl = "https://fantia.jp/posts/FAN456";

    const searchHtml = `
      <html>
        <head>
          <title>検索結果 - fantia</title>
        </head>
        <body></body>
      </html>
    `;

    const postsHtml = `
      <html>
        <head>
          <title>FAN456 Post Title - fantia</title>
          <meta property="og:image" content="https://fantia.jp/blurred_ogp/post_cover.jpg" />
          <script type="application/ld+json">
            {"fanclub_user_name":"PostCreator","tag":"TagA,TagB","datePublished":"2023-06-20"}
          </script>
        </head>
        <body>
          <div class="product-description">Post description text</div>
        </body>
      </html>
    `;

    const fixtures = new Map<string, string>([
      [productsUrl, searchHtml],
      [postsUrl, postsHtml],
    ]);
    const crawler = new FantiaCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number,
      site: Website.FANTIA,
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    expect(response.result.data.number).toBe("FAN-456");
    expect(response.result.data.title).toBe("FAN456 Post Title - fantia");
    expect(response.result.data.actors).toEqual(["PostCreator"]);
    expect(response.result.data.publisher).toBe("PostCreator");
    expect(response.result.data.genres).toEqual(["TagA", "TagB"]);
    expect(response.result.data.release_date).toBe("2023-06-20");
    expect(response.result.data.thumb_url).toBe("https://fantia.jp/main/post_cover.jpg");
    expect(response.result.data.plot).toBe("Post description text");
  });

  it("returns an explicit error when Fantia serves the age verification page", async () => {
    const number = "FAN-789";
    const detailUrl = "https://fantia.jp/products/FAN789";

    const detailHtml = `
      <html>
        <head>
          <title>Age Check - fantia</title>
        </head>
        <body>
          <div class="list-group-item-title">あなたは18歳以上ですか？</div>
        </body>
      </html>
    `;

    const fixtures = new Map<string, string>([[detailUrl, detailHtml]]);
    const crawler = new FantiaCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number,
      site: Website.FANTIA,
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("expected failure");
    }

    expect(response.result.error).toContain("age verification");
  });

  it("returns an error when neither products nor posts URL resolves", async () => {
    const number = "FAN-999";
    const productsUrl = "https://fantia.jp/products/FAN999";
    const postsUrl = "https://fantia.jp/posts/FAN999";

    const searchHtml = `
      <html>
        <head>
          <title>検索結果 - fantia</title>
        </head>
        <body></body>
      </html>
    `;

    const fixtures = new Map<string, string>([
      [productsUrl, searchHtml],
      [postsUrl, searchHtml],
    ]);
    const crawler = new FantiaCrawler(withGateway(new FixtureNetworkClient(fixtures)));

    const response = await crawler.crawl({
      number,
      site: Website.FANTIA,
    });

    expect(response.result.success).toBe(false);
    if (response.result.success) {
      throw new Error("expected failure");
    }

    expect(response.result.error).toContain("Search URL not generated");
  });
});

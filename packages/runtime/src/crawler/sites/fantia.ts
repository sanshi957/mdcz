import type { SiteRequestConfig } from "@main/services/network";
import { normalizeCode } from "@main/utils/normalization";
import { Website } from "@mdcz/shared/enums";
import type { CrawlerData } from "@mdcz/shared/types";
import type { CheerioAPI } from "cheerio";
import { load } from "cheerio";
import fs from "fs/promises";
import path from "path";
import { BaseCrawler } from "../base/BaseCrawler";
import { parseDate } from "../base/parser";
import type { Context, SearchPageResolution } from "../base/types";
import type { CrawlerRegistration } from "../registration";

const FANTIA_BASE_URL = "https://fantia.jp";
const FANTIA_SITE_REQUEST_CONFIGS: readonly SiteRequestConfig[] = [
  {
    id: "crawler:fantia",
    matches: (url) => url.hostname === "fantia.jp" || url.hostname.endsWith(".fantia.jp"),
    headers: {
      referer: `${FANTIA_BASE_URL}/`,
      "accept-language": "zh-CN,zh;q=0.9",
    },
  },
];

const isAgeVerificationPage = ($: CheerioAPI): boolean => {
  const ageConfirmTitle = $(".list-group-item-title").first().text().trim();
  if (ageConfirmTitle.includes("あなたは18歳以上ですか？")) {
    return true;
  }

  const ageConfirmText = $(".age-confirmation-text").first().text().trim();
  if (ageConfirmText.includes("成人向けの画像、動画、テキストなどが表示される可能性があります")) {
    return true;
  }

  const confirmButton = $("input[value*='続行'], input[value*='はい、18歳以上です']").length > 0;
  if (confirmButton) {
    return true;
  }

  return false;
};

const getJsonLdValue = ($: CheerioAPI, key: string): string | undefined => {
  const scripts = $('script[type="application/ld+json"]');

  for (const script of scripts) {
    try {
      const htmlContent = $(script).html();
      if (htmlContent !== null) {
        const data = JSON.parse(htmlContent);
        if (data[key] !== undefined && data[key] !== null) {
          return String(data[key]);
        }
      }
    } catch (e) {}
  }

  return undefined;
};

const getMainImage = ($: CheerioAPI): string | undefined => {
  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  return ogImage.replace("blurred_ogp", "main");
};

const getProductPlot = ($: CheerioAPI): string | undefined => {
  const plot = $(".product-description").first().text().trim();
  return plot;
};

const getPostPlot = ($: CheerioAPI): string | undefined => {
  const plot = $(".product-description").first().text().trim();
  return plot;
};

const normalizeNumber = (value: string | undefined | null): string => {
  const normalized = normalizeCode(value);
  const fantiaMatch = normalized.match(/FANTIA(\d{5,7})/);
  if (fantiaMatch) {
    return fantiaMatch[1];
  }
  const codeMatch = normalized.match(/([A-Z]{3,6})(\d{2,5})/);
  if (codeMatch) {
    return codeMatch[1] + codeMatch[2];
  }
  return normalized;
};

const saveDebugHtml = async (filePath: string, html: string) => {
  try {
    await fs.writeFile(filePath, html);
    console.log(`save success: ${filePath}`);
  } catch (error) {
    console.error(`save fail: ${error}`);
  }
};

export class FantiaCrawler extends BaseCrawler {
  static readonly siteRequestConfigs = FANTIA_SITE_REQUEST_CONFIGS;

  site(): Website {
    return Website.FANTIA;
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const number = normalizeNumber(context.number);
    if (!number) {
      return null;
    }

    const productsUrl = `${FANTIA_BASE_URL}/products/${number}`;
    try {
      const productsHtml = await this.fetch(productsUrl, context);
      const products$ = load(productsHtml);
      saveDebugHtml(path.join("E:\\test", `fantia_products_${Date.now()}.html`), productsHtml);
      const productsTitle = products$("title").text().trim();
      if (productsTitle && !productsTitle.includes("検索") && !productsTitle.includes("ログイン｜ファンティア[Fantia]")) {
        return productsUrl;
      }
    } catch {
      this.logger.debug(`Failed to fetch products page for number: ${number}`);
    }

    const postsUrl = `${FANTIA_BASE_URL}/posts/${number}`;
    try {
      const postsHtml = await this.fetch(postsUrl, context);
      const posts$ = load(postsHtml);
      saveDebugHtml(path.join("E:\\test", `fantia_posts_${Date.now()}.html`), postsHtml);
      const postsTitle = posts$("title").text().trim();
      if (postsTitle && !postsTitle.includes("検索") && !postsTitle.includes("ログイン｜ファンティア[Fantia]")) {
        return postsUrl;
      }
    } catch {
      this.logger.debug(`Failed to fetch posts page for number: ${number}`);
    }

    return null;
  }

  protected async parseSearchPage(
    context: Context,
    $: CheerioAPI,
    searchUrl: string,
  ): Promise<string | SearchPageResolution | null> {
    if (isAgeVerificationPage($)) {
      this.logger.debug("Fantia age verification detected; please login first via browser and provide cookies");
      throw new Error("Fantia age verification detected; please login first via browser and provide cookies");
    }

    return this.reuseSearchDocument(searchUrl);
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    this.logger.debug(`url is ${_detailUrl}`);
    // saveDebugHtml(path.join("E:\\test", `fantia_${Date.now()}.html`), $.html());
    const title = $("title").text().trim();
    if (!title) {
      return null;
    }
    const number = context.number;
    const publisher = getJsonLdValue($, "fanclub_user_name");
    if (!publisher) {
      return null;
    }
    const actors = [publisher];
    const tagsRaw = getJsonLdValue($, "tag");
    const tags = tagsRaw ? tagsRaw.split(",").map((tag) => tag.trim()) : [];
    const thumbUrl = getMainImage($);
    if (!thumbUrl) {
      return null;
    }
    const scene_images = [thumbUrl];

    this.logger.debug(`title is ${title}`);
    this.logger.debug(`number is ${number}`);
    this.logger.debug(`actors is ${actors}`);
    this.logger.debug(`tags is ${tags}`);
    this.logger.debug(`thumb_url is ${thumbUrl}`);

    if (_detailUrl.includes("/products")) {
      const releaseDate = parseDate(getJsonLdValue($, "uploadDate"));
      const plot = getProductPlot($);

      return {
        title,
        number,
        actors,
        genres: tags,
        publisher,
        studio: publisher,
        director: publisher,
        plot,
        release_date: releaseDate,
        rating: undefined,
        thumb_url: thumbUrl,
        scene_images,
        website: Website.FANTIA,
      };
    }

    if (_detailUrl.includes("/posts")) {
      const releaseDate = parseDate(getJsonLdValue($, "datePublished"));
      const plot = getPostPlot($);

      return {
        title,
        number,
        actors,
        genres: tags,
        publisher,
        studio: publisher,
        director: publisher,
        plot,
        release_date: releaseDate,
        rating: undefined,
        thumb_url: thumbUrl,
        scene_images,
        website: Website.FANTIA,
      };
    }

    return null;
  }
}

export const crawlerRegistration: CrawlerRegistration = {
  site: Website.FANTIA,
  crawler: FantiaCrawler,
};

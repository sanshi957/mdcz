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

// const FANTIA_PREFIX_REGEX = /fantia[-_]([0-9]{3,8})/i;
// const regex = /^[a-z]{2,6}[-_][0-9]{3,7}$/i;
const FANTIA_PREFIX_REGEX = /fantia[-_]([0-9]{3,8})/i;

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

    return `${FANTIA_BASE_URL}/products?brand_type=0&category=&keyword=${number}`;
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

    const resultProducts = $(".col-xs-4.col-sm-4.col-md-3.col-lg-2.mb-20.mb-10-xs");
    if (resultProducts.length > 0) {
      const detailUrl = `${FANTIA_BASE_URL}${resultProducts.find("a").attr("href")}`;
      return detailUrl;
    }

    if (context.number.match(FANTIA_PREFIX_REGEX)) {
      const productsUrl = `${FANTIA_BASE_URL}/products/${normalizeNumber(context.number)}`;
      const productsHtml = await this.gateway.fetchHtml(productsUrl, context.options);
      const products$ = load(productsHtml);
      const productsTitle = products$("title");
      if (productsTitle && !productsTitle.text().includes("検索")) {
        return productsUrl;
      }

      const postsUrl = `${FANTIA_BASE_URL}/posts/${normalizeNumber(context.number)}`;
      const postsHtml = await this.gateway.fetchHtml(postsUrl, context.options);
      const posts$ = load(postsHtml);
      const postsTitle = posts$("title");
      if (postsTitle && !postsTitle.text().includes("検索")) {
        return postsUrl;
      }
    }

    const postsSearchUrl = `${FANTIA_BASE_URL}/posts?brand_type=0&category=&keyword=${normalizeNumber(context.number)}`;
    const postsSearchHtml = await this.gateway.fetchHtml(postsSearchUrl, context.options);
    const postsSearch$ = load(postsSearchHtml);

    const resultPosts = postsSearch$(".col-xs-4.col-sm-4.col-md-3.col-lg-2.mb-20.mb-10-xs");
    if (resultPosts.length > 0) {
      const detailUrl = `${FANTIA_BASE_URL}${resultPosts.find("a").attr("href")}`;
      return detailUrl;
    }

    this.logger.debug(`unmatch url is ${searchUrl}`);
    return null;
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    this.logger.debug(`url is ${_detailUrl}`);
    saveDebugHtml(path.join("E:\\test", `fantia_${Date.now()}.html`), $.html());
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

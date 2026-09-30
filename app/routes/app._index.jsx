import { useState } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

const decodeHtmlEntities = (value = "") =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '\"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const htmlToPlainText = (html = "") =>
  decodeHtmlEntities(
    html
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n\n")
      .replace(/<\/div\s*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/li\s*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const escapeHtml = (value = "") =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const plainTextToHtml = (text = "") =>
  text
    .replace(/\r/g, "")
    .trim()
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim())
    .map(
      (paragraph) =>
        `<p>${escapeHtml(paragraph.trim()).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
	const actionLocalesResponse = await admin.graphql(
  `#graphql
    query GetActionShopLocales {
      shopLocales {
        locale
        primary
        published
      }
    }
  `,
);

const actionLocalesData = await actionLocalesResponse.json();

const actionLocales = actionLocalesData.data.shopLocales;

const targetLocale = actionLocales.find(
  (locale) => !locale.primary && locale.published,
)?.locale;
  const formData = await request.formData();
const formType = formData.get("formType");

  const resourceIds = formData.getAll("resourceId");
const translationValues = formData.getAll("translationValue");
const translationKeys = formData.getAll("translationKey");
const originalTranslationValues = formData.getAll("originalTranslationValue");

if (!targetLocale) {
  return {
    success: false,
    formType,
    message: "Çeviri yapılacak ikinci bir yayınlanmış dil bulunamadı.",
  };
}

  const savedTranslations = [];

for (let i = 0; i < resourceIds.length; i++) {
  const resourceId = resourceIds[i];
const translationValue = translationValues[i]?.trim();
const translationKey = translationKeys[i] || "label";
const originalTranslationValue = originalTranslationValues[i]?.trim() || "";

  if (translationValue === originalTranslationValue) {
    continue;
  }

  if (!resourceId || !translationValue) {
    continue;
  }

  const valueForShopify =
    translationKey === "body_html"
      ? plainTextToHtml(translationValue)
      : translationValue;

  const digestResponse = await admin.graphql(
    `#graphql
      query GetTranslatableResource($resourceId: ID!) {
        translatableResource(resourceId: $resourceId) {
          resourceId
          translatableContent {
            key
            value
            locale
            digest
          }
        }
      }
    `,
    {
      variables: {
        resourceId,
      },
    },
  );

  const digestData = await digestResponse.json();

  const translatableContent =
  digestData.data?.translatableResource?.translatableContent?.find(
    (item) => item.key === translationKey,
  );

  if (!translatableContent?.digest) {
    return {
      success: false,
      formType,
      message: "Çevrilebilir alan veya digest bulunamadı.",
    };
  }

  const translationResponse = await admin.graphql(
    `#graphql
      mutation RegisterTranslation(
        $resourceId: ID!
        $translations: [TranslationInput!]!
      ) {
        translationsRegister(
          resourceId: $resourceId
          translations: $translations
        ) {
          translations {
            key
            value
            locale
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        resourceId,
        translations: [
          {
            locale: targetLocale,
            key: translationKey,
value: valueForShopify,
translatableContentDigest: translatableContent.digest,
          },
        ],
      },
    },
  );

  const translationData = await translationResponse.json();

  const errors =
    translationData.data?.translationsRegister?.userErrors || [];

  if (errors.length > 0) {
    return {
      success: false,
      formType,
      message: errors.map((error) => error.message).join(", "),
    };
  }

  savedTranslations.push(valueForShopify);
}

return {
  success: true,
  formType,
  message:
    savedTranslations.length > 0
      ? `${savedTranslations.length} çeviri kaydedildi.`
      : "Değişiklik yok; hiçbir çeviri yeniden kaydedilmedi.",
};
};

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

const localesResponse = await admin.graphql(
  `#graphql
    query GetShopLocalesForAction {
      shopLocales {
        locale
        primary
        published
      }
    }
  `,
);

const localesData = await localesResponse.json();
const locales = localesData.data.shopLocales;

const targetLocale = locales.find(
  (locale) => !locale.primary && locale.published,
)?.locale;

  const response = await admin.graphql(`
    #graphql
    query GetProductsWithOptions {
      products(first: 20) {
        nodes {
          id
          title
          status
          options {
            id
            name
            optionValues {
              id
              name
              linkedMetafieldValue
            }
          }
        }
      }
    }
  `);

  const data = await response.json();
  const products = data.data.products.nodes;

const productOptions = [
  ...new Map(
    products
      .flatMap((product) => product.options)
      .map((option) => [
        option.id,
        {
          id: option.id,
          name: option.name,
        },
      ]),
  ).values(),
];

  const metaobjectIds = [
    ...new Set(
      products.flatMap((product) =>
        product.options.flatMap((option) =>
          option.optionValues
            .map((value) => value.linkedMetafieldValue)
            .filter(Boolean),
        ),
      ),
    ),
  ];

  let metaobjects = [];

  if (metaobjectIds.length > 0) {
    const metaResponse = await admin.graphql(
      `#graphql
        query GetColorMetaobjects($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Metaobject {
              id
              handle
              type
              displayName
              fields {
                key
                value
              }
            }
          }
        }
      `,
      {
        variables: {
          ids: metaobjectIds,
        },
      },
    );

    const metaData = await metaResponse.json();
    metaobjects = metaData.data.nodes.filter(
  (node) => node && node.type === "shopify--color-pattern"
);
  }


let existingTranslations = {};

for (const metaobject of metaobjects) {
  const translationResponse = await admin.graphql(
    `#graphql
      query GetExistingTranslation($resourceId: ID!) {
        translatableResource(resourceId: $resourceId) {
          translations(locale: "en") {
            key
            value
            locale
          }
        }
      }
    `,
    {
      variables: {
        resourceId: metaobject.id,
      },
    },
  );

  const translationData = await translationResponse.json();

  existingTranslations[metaobject.id] =
    translationData.data?.translatableResource?.translations || [];
}

  let productTranslations = {};

for (const product of products) {
  const productTranslationResponse = await admin.graphql(
    `#graphql
      query GetProductTranslations($resourceId: ID!) {
        translatableResource(resourceId: $resourceId) {
          translations(locale: "en") {
            key
            value
            locale
          }
        }
      }
    `,
    {
      variables: {
        resourceId: product.id,
      },
    },
  );

  const productTranslationData =
    await productTranslationResponse.json();

  productTranslations[product.id] =
    productTranslationData.data?.translatableResource?.translations || [];
}

 return {
  products,
  productOptions,
  metaobjects,
  locales,
  existingTranslations,
  productTranslations,
};
};

const COLOR_SUGGESTIONS = {
  Bej: "Beige",
  Beyaz: "White",
  Siyah: "Black",
  Lacivert: "Navy",
  Gri: "Grey",
  Haki: "Khaki",
  Kahverengi: "Brown",
  Mürdüm: "Burgundy",
  Antrasit: "Anthracite",
  Kırmızı: "Red",
  Bordo: "Burgundy",
  Mavi: "Blue",
  Yeşil: "Green",
  Sarı: "Yellow",
  Turuncu: "Orange",
  Pembe: "Pink",
  Mor: "Purple",
  Ekru: "Ecru",
  Krem: "Cream",
  Taş: "Stone",
"Açık Kahverengi": "Light Brown",
"Koyu Kahverengi": "Dark Brown",
Vizon: "Mink",
Karamel: "Caramel",
};

const OPTION_SUGGESTIONS = {
  Renk: "Color",
  Boyut: "Size",
  Beden: "Size",
};

export default function Index() {
  	const {
  products,
  productOptions,
  metaobjects,
  locales,
  existingTranslations,
  productTranslations,
} = useLoaderData();
	const actionData = useActionData();

const [showOnlyMissingProducts, setShowOnlyMissingProducts] = useState(false);
const [productSearch, setProductSearch] = useState("");

const [showOnlyMissingColors, setShowOnlyMissingColors] = useState(false);
const [colorSearch, setColorSearch] = useState("");
const [editedValues, setEditedValues] = useState({});

const getEditedValue = (key, originalValue = "") =>
  Object.prototype.hasOwnProperty.call(editedValues, key)
    ? editedValues[key]
    : originalValue;

const updateEditedValue = (key, value) => {
  setEditedValues((current) => ({
    ...current,
    [key]: value,
  }));
};

const isEdited = (key, originalValue = "") =>
  getEditedValue(key, originalValue).trim() !== String(originalValue || "").trim();

const productTranslationStatus = products.map((product) => {
  const translations = productTranslations[product.id] || [];

  const titleTranslation = translations.find(
    (translation) => translation.key === "title",
  )?.value;

  const descriptionTranslationHtml = translations.find(
    (translation) => translation.key === "body_html",
  )?.value;

  const descriptionTranslation = htmlToPlainText(
    descriptionTranslationHtml || "",
  );

  return {
  id: product.id,
  title: product.title,
  titleTranslation: titleTranslation || "",
  descriptionTranslation,
  titleTranslated: Boolean(titleTranslation),
  descriptionTranslated: Boolean(descriptionTranslationHtml),
};
});

const sortedProductTranslationStatus = [...productTranslationStatus].sort(
  (a, b) => {
    const aMissing =
      Number(!a.titleTranslated) + Number(!a.descriptionTranslated);
    const bMissing =
      Number(!b.titleTranslated) + Number(!b.descriptionTranslated);

    return bMissing - aMissing;
  },
);

const missingProductCount = productTranslationStatus.filter(
  (product) =>
    !product.titleTranslated || !product.descriptionTranslated,
).length;

const incompleteProducts = sortedProductTranslationStatus.filter(
  (product) =>
    !product.titleTranslated || !product.descriptionTranslated,
);

const normalizedProductSearch = productSearch.trim().toLocaleLowerCase("tr-TR");

const visibleProducts = (
  showOnlyMissingProducts
    ? incompleteProducts
    : sortedProductTranslationStatus
).filter((product) => {
  if (!normalizedProductSearch) return true;

  const searchableText = [
    product.title,
    product.titleTranslation,
    product.descriptionTranslation,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("tr-TR");

  return searchableText.includes(normalizedProductSearch);
});

const colorTranslations = metaobjects

  .map((metaobject) => {
    const label = metaobject.fields?.find(
      (field) => field.key === "label"
    )?.value;

    if (!label) return null;

    const englishTranslation =
  existingTranslations[metaobject.id]?.find(
    (translation) => translation.key === "label",
  )?.value;

return {
  id: metaobject.id,
  label,
  existingTranslation: englishTranslation || "",
};
  })
  .filter(Boolean);

const sortedColorTranslations = [...colorTranslations].sort(
  (a, b) =>
    Number(Boolean(a.existingTranslation)) -
    Number(Boolean(b.existingTranslation)),
);

const missingColorCount = colorTranslations.filter(
  (color) => !color.existingTranslation,
).length;

const incompleteColors = sortedColorTranslations.filter(
  (color) => !color.existingTranslation,
);

const normalizedColorSearch = colorSearch.trim().toLocaleLowerCase("tr-TR");

const visibleColors = (
  showOnlyMissingColors
    ? incompleteColors
    : sortedColorTranslations
).filter((color) => {
  if (!normalizedColorSearch) return true;

  const searchableText = [
    color.label,
    color.existingTranslation,
    COLOR_SUGGESTIONS[color.label],
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("tr-TR");

  return searchableText.includes(normalizedColorSearch);
});

const totalProductCount = products.length;

const translatedProductCount =
  totalProductCount - missingProductCount;

const totalColorCount = colorTranslations.length;

const translatedColorCount =
  totalColorCount - missingColorCount;

const optionTranslations = Object.values(
  productOptions.reduce((groups, option) => {
    const suggestion = OPTION_SUGGESTIONS[option.name];

    if (!suggestion) return groups;

    if (!groups[option.name]) {
      groups[option.name] = {
        name: option.name,
        suggestion,
        ids: [],
      };
    }

    groups[option.name].ids.push(option.id);

    return groups;
  }, {}),
);
  return (
    <s-page heading="Mia Noura Translation Tool">

<s-section heading="Özet">
  <s-stack direction="inline" gap="base">
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-text type="strong">Ürünler</s-text>
      <s-text>
        {translatedProductCount} / {totalProductCount} çevrildi
      </s-text>
    </s-box>

    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-text type="strong">Renkler</s-text>
      <s-text>
        {translatedColorCount} / {totalColorCount} çevrildi
      </s-text>
    </s-box>

    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-text type="strong">Eksikler</s-text>
      <s-text tone={missingProductCount + missingColorCount > 0 ? "critical" : "success"}>
        {missingProductCount + missingColorCount > 0
          ? `${missingProductCount + missingColorCount} eksik`
          : "✓ Eksik yok"}
      </s-text>
    </s-box>
  </s-stack>
</s-section>

      <s-section heading="Ürün Seçenekleri">
        <s-paragraph>
          Shopify mağazasından {products.length} ürün bulundu.
		<s-paragraph>
  Diller:{" "}
  {locales
    .map(
      (locale) =>
        `${locale.locale} | primary=${locale.primary} | published=${locale.published}`,
    )
    .join(" • ")}
</s-paragraph>
        </s-paragraph>

</s-section>

<s-section heading="Seçenek Adı Çevirileri">
  <Form method="post">
    <input
      type="hidden"
      name="formType"
      value="optionTranslations"
    />

    <s-stack direction="block" gap="base">

      {optionTranslations.map((option) => (
        <s-box key={option.name} padding="base">

          <s-text>
            {option.name} → {option.suggestion} ({option.ids.length} seçenek)
          </s-text>

          {option.ids.map((id) => (
            <div key={id}>
              <input
                type="hidden"
                name="resourceId"
                value={id}
              />

              <input
                type="hidden"
                name="translationValue"
                value={option.suggestion}
              />

              <input
                type="hidden"
                name="translationKey"
                value="name"
              />
            </div>
          ))}

        </s-box>
      ))}

      <s-button type="submit" variant="primary">
  Seçenek Adlarını Kaydet
</s-button>

{actionData?.formType === "optionTranslations" && actionData?.message && (
  <s-text tone={actionData.success ? "success" : "critical"}>
    {actionData.message}
  </s-text>
)}

    </s-stack>
  </Form>
</s-section>

<s-section heading="Ürün Çevirileri">
<s-text tone={missingProductCount > 0 ? "critical" : "success"}>
  {missingProductCount > 0
    ? `Eksik ürün çevirisi: ${missingProductCount}`
    : "✓ Tüm ürün başlıkları ve açıklamaları çevrildi"}
</s-text>

<s-stack direction="block" gap="base">
  <s-text-field
    label="Ürün ara"
    placeholder="Ürün kodu, ürün adı, İngilizce başlık veya açıklama..."
    value={productSearch}
    onInput={(event) => setProductSearch(event.currentTarget.value)}
  />

  <s-button
    onClick={() => setShowOnlyMissingProducts(!showOnlyMissingProducts)}
    variant="secondary"
  >
    {showOnlyMissingProducts
      ? "Tüm ürünleri göster"
      : "Sadece eksikleri göster"}
  </s-button>

  {productSearch.trim() && (
    <s-text>
      {visibleProducts.length} ürün bulundu
    </s-text>
  )}
</s-stack>

{showOnlyMissingProducts && incompleteProducts.length === 0 && (
  <s-text tone="success">
    ✓ Eksik ürün çevirisi yok
  </s-text>
)}

<s-paragraph>
  Açıklamalar düzenlerken HTML etiketleri gizlenir. Kaydettiğinde metin Shopify için temiz HTML olarak saklanır.
</s-paragraph>

<Form method="post">

<input
  type="hidden"
  name="formType"
  value="productTranslations"
/>

  <s-stack direction="block" gap="base">
    {productSearch.trim() && visibleProducts.length === 0 && (
      <s-text>
        Aramana uyan ürün bulunamadı.
      </s-text>
    )}

    {visibleProducts.map((product) => (
      <s-box
        key={product.id}
        padding="base"
        borderWidth="base"
        borderRadius="base"
      >
        <s-stack direction="block" gap="extra-tight">
          <s-text type="strong">{product.title}</s-text>

<s-text-field
  label="İngilizce Başlık"
  name="translationValue"
  value={getEditedValue(
    `product:${product.id}:title`,
    product.titleTranslation,
  )}
  onInput={(event) =>
    updateEditedValue(
      `product:${product.id}:title`,
      event.currentTarget.value,
    )
  }
/>

{isEdited(`product:${product.id}:title`, product.titleTranslation) && (
  <s-text tone="warning">● Değiştirildi</s-text>
)}

<input
  type="hidden"
  name="originalTranslationValue"
  value={product.titleTranslation}
/>

<input
  type="hidden"
  name="resourceId"
  value={product.id}
/>

<input
  type="hidden"
  name="translationKey"
  value="title"
/>

<s-text-field
  label="İngilizce Açıklama"
  name="translationValue"
  value={getEditedValue(
    `product:${product.id}:body_html`,
    product.descriptionTranslation,
  )}
  multiline={4}
  onInput={(event) =>
    updateEditedValue(
      `product:${product.id}:body_html`,
      event.currentTarget.value,
    )
  }
/>

{isEdited(
  `product:${product.id}:body_html`,
  product.descriptionTranslation,
) && <s-text tone="warning">● Değiştirildi</s-text>}

<input
  type="hidden"
  name="originalTranslationValue"
  value={product.descriptionTranslation}
/>

<input
  type="hidden"
  name="resourceId"
  value={product.id}
/>

<input
  type="hidden"
  name="translationKey"
  value="body_html"
/>

          <s-text tone={product.titleTranslated ? "success" : "critical"}>
            {product.titleTranslated
              ? "✓ Başlık çevrildi"
              : "Eksik başlık çevirisi"}
          </s-text>

          <s-text
            tone={product.descriptionTranslated ? "success" : "critical"}
          >
            {product.descriptionTranslated
              ? "✓ Açıklama çevrildi"
              : "Eksik açıklama çevirisi"}
          </s-text>
        </s-stack>
      </s-box>
    ))}

<s-button type="submit" variant="primary">
  Ürün Çevirilerini Kaydet
</s-button>

{actionData?.formType === "productTranslations" && actionData?.message && (
  <s-text tone={actionData.success ? "success" : "critical"}>
    {actionData.message}
  </s-text>
)}

</s-stack>
</Form>
</s-section>

<s-section heading="Renk Çevirileri">

  <s-text tone={missingColorCount > 0 ? "critical" : "success"}>
    {missingColorCount > 0
      ? `Eksik renk çevirisi: ${missingColorCount}`
      : "✓ Tüm renk çevirileri tamamlandı"}
  </s-text>

  <s-stack direction="block" gap="base">
    <s-text-field
      label="Renk ara"
      placeholder="Türkçe veya İngilizce renk adı..."
      value={colorSearch}
      onInput={(event) => setColorSearch(event.currentTarget.value)}
    />

    <s-button
      onClick={() => setShowOnlyMissingColors(!showOnlyMissingColors)}
      variant="secondary"
    >
      {showOnlyMissingColors
        ? "Tüm renkleri göster"
        : "Sadece eksik renkleri göster"}
    </s-button>

    {colorSearch.trim() && (
      <s-text>
        {visibleColors.length} renk bulundu
      </s-text>
    )}
  </s-stack>

{showOnlyMissingColors && incompleteColors.length === 0 && (
  <s-text tone="success">
    ✓ Eksik renk çevirisi yok
  </s-text>
)}

  <Form method="post">

<input
  type="hidden"
  name="formType"
  value="colorTranslations"
/>

  <s-stack direction="block" gap="base">
    {colorSearch.trim() && visibleColors.length === 0 && (
      <s-text>
        Aramana uyan renk bulunamadı.
      </s-text>
    )}

    {visibleColors.map((color) => (
      <s-box
        key={color.id}
        padding="base"
        borderWidth="base"
        borderRadius="base"
      >
        <s-stack direction="block" gap="extra-tight">
  <s-text type="strong">{color.label}</s-text>

  <s-text tone={color.existingTranslation ? "success" : "critical"}>
    {color.existingTranslation
      ? `✓ Çevrildi: ${color.existingTranslation}`
      : "Eksik çeviri"}
  </s-text>
</s-stack>

        <input
          type="hidden"
          name="resourceId"
          value={color.id}
        />

        <s-text-field
          label="Çeviri"
          name="translationValue"
          value={getEditedValue(
            `color:${color.id}:label`,
            color.existingTranslation || COLOR_SUGGESTIONS[color.label] || "",
          )}
          onInput={(event) =>
            updateEditedValue(
              `color:${color.id}:label`,
              event.currentTarget.value,
            )
          }
        ></s-text-field>

        {isEdited(
          `color:${color.id}:label`,
          color.existingTranslation || COLOR_SUGGESTIONS[color.label] || "",
        ) && <s-text tone="warning">● Değiştirildi</s-text>}

        <input
          type="hidden"
          name="originalTranslationValue"
          value={color.existingTranslation}
        />
      </s-box>
    ))}

    {(!showOnlyMissingColors || incompleteColors.length > 0) && (
  <s-button type="submit" variant="primary">
    Tüm Çevirileri Kaydet
  </s-button>
)}

{actionData?.formType === "colorTranslations" && actionData?.message && (
  <s-text tone={actionData.success ? "success" : "critical"}>
    {actionData.message}
  </s-text>
)}

  </s-stack>
</Form>
</s-section>

</s-page>
);
}
import { Form, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

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

  const resourceIds = formData.getAll("resourceId");
const translationValues = formData.getAll("translationValue");
const translationKeys = formData.getAll("translationKey");

if (!targetLocale) {
  return {
    success: false,
    message: "Çeviri yapılacak ikinci bir yayınlanmış dil bulunamadı.",
  };
}

  const savedTranslations = [];

for (let i = 0; i < resourceIds.length; i++) {
  const resourceId = resourceIds[i];
const translationValue = translationValues[i]?.trim();
const translationKey = translationKeys[i] || "label";

  if (!resourceId || !translationValue) {
    continue;
  }

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
value: translationValue,
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
      message: errors.map((error) => error.message).join(", "),
    };
  }

  savedTranslations.push(translationValue);
}

return {
  success: true,
  message: `${savedTranslations.length} renk çevirisi kaydedildi.`,
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
          translations(locale: "tr") {
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

  

 return {
  products,
  productOptions,
  metaobjects,
  locales,
  existingTranslations,
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
  Size: "Size",
};

export default function Index() {
  	const {
  products,
  productOptions,
  metaobjects,
  locales,
  existingTranslations,
} = useLoaderData();
	const actionData = useActionData();

const colorTranslations = metaobjects
  .map((metaobject) => {
    const label = metaobject.fields?.find(
      (field) => field.key === "label"
    )?.value;

    if (!label) return null;

    return {
      id: metaobject.id,
      label,
    };
  })
  .filter(Boolean);

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

    </s-stack>
  </Form>
</s-section>

<s-section heading="Renk Çevirileri">

{actionData?.message && (
  <s-paragraph>
    {actionData.message}
  </s-paragraph>
)}

  <Form method="post">
  <s-stack direction="block" gap="base">
    {colorTranslations.map((color) => (
      <s-box
        key={color.id}
        padding="base"
        borderWidth="base"
        borderRadius="base"
      >
        <s-text type="strong">{color.label}</s-text>

        <input
          type="hidden"
          name="resourceId"
          value={color.id}
        />

        <s-text-field
          label="Çeviri"
          name="translationValue"
          value={
  existingTranslations[color.id]?.find(
    (translation) => translation.key === "label"
  )?.value ||
  COLOR_SUGGESTIONS[color.label] ||
  ""
}
        ></s-text-field>
      </s-box>
    ))}

    <s-button type="submit" variant="primary">
      Tüm Çevirileri Kaydet
    </s-button>
  </s-stack>
</Form>
</s-section>

        <s-stack direction="block" gap="base">
          {products.map((product) => (
            <s-box
              key={product.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-text type="strong">{product.title}</s-text>

              {product.options.map((option) => (
                <s-box key={option.id} paddingBlockStart="base">
                  <s-text type="strong">
                    Seçenek: {option.name}
                  </s-text>

                  {option.optionValues.map((value) => (
                    <s-paragraph key={value.id}>
                      {value.name}
                      {value.linkedMetafieldValue ? (
  <>
    {" — "}
    {(() => {
      const metaobject = metaobjects.find(
        (item) => item.id === value.linkedMetafieldValue,
      );

      const label = metaobject?.fields?.find(
        (field) => field.key === "label",
      )?.value;

      return label
        ? `Metaobject etiketi: ${label}`
        : "Metaobject bulundu, etiket yok";
    })()}
  </>
) : (
  " — Standart değer"
)}
                        
                    </s-paragraph>
                  ))}
                </s-box>
              ))}
            </s-box>
          ))}
{actionData?.message && (
  <s-paragraph>
    {actionData.message}
  </s-paragraph>
)}

</s-stack>

<Form method="post">
  <input
    type="hidden"
    name="resourceId"
    value="gid://shopify/Metaobject/539641544934"
  />

  <input
    type="hidden"
    name="translationValue"
    value="Anthracite"
  />

  <s-button type="submit" variant="primary">
    Antrasit → Anthracite Çevir
  </s-button>
</Form>
</s-page>
);
}
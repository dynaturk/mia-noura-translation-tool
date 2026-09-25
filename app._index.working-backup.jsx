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

  const resourceId = formData.get("resourceId");
  const translationValue = formData.get("translationValue");

if (!targetLocale) {
  return {
    success: false,
    message: "Çeviri yapılacak ikinci bir yayınlanmış dil bulunamadı.",
  };
}

  if (!resourceId || !translationValue) {
    return {
      success: false,
      message: "Çeviri için gerekli bilgiler eksik.",
    };
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

  const labelContent =
    digestData.data?.translatableResource?.translatableContent?.find(
      (item) => item.key === "label",
    );

  if (!labelContent?.digest) {
    return {
      success: false,
      message: "Metaobject label bilgisi veya digest bulunamadı.",
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
            key: "label",
            value: translationValue,
            translatableContentDigest: labelContent.digest,
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

  return {
  success: true,
  message: `${targetLocale.toUpperCase()} çevirisi kaydedildi: ${translationValue}`,
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
    metaobjects = metaData.data.nodes.filter(Boolean);
  }
  return {
  products,
  metaobjects,
  locales,
};
};

export default function Index() {
  const { products, metaobjects, locales } = useLoaderData();
	const actionData = useActionData();

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
        </s-stack>
      </s-section>
    </s-page>
  );
}
package com.daksh.medicart.tests;

import com.daksh.medicart.base.BaseTest;
import org.testng.annotations.Test;

import static io.restassured.RestAssured.given;
import static io.restassured.module.jsv.JsonSchemaValidator.matchesJsonSchemaInClasspath;
import static org.hamcrest.Matchers.*;

public class CatalogApiTest extends BaseTest {

    @Test(description = "Search is case-insensitive and partial")
    public void searchIsCaseInsensitive() {
        given().queryParam("q", "PARACET").get("/api/medicines")
                .then().statusCode(200).body("count", equalTo(1)).body("items[0].id", equalTo("M1"));
    }

    @Test(description = "Rx filter returns only prescription medicines")
    public void rxFilter() {
        given().queryParam("rx", "true").get("/api/medicines")
                .then().statusCode(200).body("items.rxRequired", everyItem(is(true))).body("items.size()", greaterThan(0));
    }

    @Test(description = "inStock filter hides out-of-stock medicines")
    public void inStockFilter() {
        given().queryParam("inStock", "true").get("/api/medicines")
                .then().statusCode(200).body("items.id", not(hasItem("M5")));
    }

    @Test(description = "Medicine response matches JSON schema")
    public void medicineMatchesSchema() {
        given().get("/api/medicines/M1").then().statusCode(200).body(matchesJsonSchemaInClasspath("schemas/medicine.json"));
    }

    @Test(description = "Unknown medicine returns 404 with standard error shape")
    public void unknownMedicine() {
        given().get("/api/medicines/NOPE")
                .then().statusCode(404).body("error", equalTo("NOT_FOUND")).body(matchesJsonSchemaInClasspath("schemas/error.json"));
    }
}

package integrations

import (
	"context"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

type fakeS3 struct {
	objects []types.Object
	deleted []string
}

func (f *fakeS3) ListObjectsV2(_ context.Context, input *s3.ListObjectsV2Input, _ ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) {
	if input.Bucket == nil || *input.Bucket == "" {
		return nil, context.Canceled
	}
	count := int32(len(f.objects))
	return &s3.ListObjectsV2Output{Contents: f.objects, KeyCount: &count}, nil
}

func (f *fakeS3) DeleteObjects(_ context.Context, input *s3.DeleteObjectsInput, _ ...func(*s3.Options)) (*s3.DeleteObjectsOutput, error) {
	for _, item := range input.Delete.Objects {
		f.deleted = append(f.deleted, aws.ToString(item.Key))
	}
	return &s3.DeleteObjectsOutput{Deleted: make([]types.DeletedObject, len(input.Delete.Objects))}, nil
}

func TestListSourceObjectsFiltersAndNormalizesMetadata(t *testing.T) {
	when := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	store := &S3Store{Client: &fakeS3{objects: []types.Object{{Key: aws.String("clips/one.mp4"), Size: aws.Int64(12), LastModified: &when}, {Key: aws.String("other.txt")}}}, SourceBucket: "youtube-downloads"}
	result, err := store.ListSourceObjects(context.Background(), "ONE", 50, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Objects) != 1 || result.Objects[0].Name != "one.mp4" || result.Objects[0].Size != 12 {
		t.Fatalf("unexpected objects: %#v", result.Objects)
	}
}

func TestDeletePrefixDeletesAllMatchingKeys(t *testing.T) {
	client := &fakeS3{}
	store := &S3Store{Client: client, Bucket: "openshorts-media"}
	count, err := store.DeletePrefix(context.Background(), "jobs/job-1/")
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 || len(client.deleted) != 0 {
		t.Fatalf("unexpected delete result: %d %#v", count, client.deleted)
	}
}
